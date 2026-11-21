"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_FIT, FITS, SCREWS, type Fit } from "@/config/drawings";
import type { DrawingEdits, DrawingRef } from "@/db/schema";
import { downloadDrawing, fetchDrawing, type DrawingResponse, type FitPart } from "@/lib/drawing/download";
import { applyEdits, dimFrame, dimHit, dimLine, dimOff, dimRect, fmt, linkNotes, measure, noteBox, partDrawing, sheetToRef, turnDim, turnViews, viewCorners, viewXf } from "@/lib/drawing/layout";
import { dimension, drawingSvg, note as noteSvg } from "@/lib/drawing/svg";
import type { Dim, DimDir, Drawing, Note, PlacedView, Pt } from "@/lib/drawing/types";
import { Icon } from "@/components/ui/Icon";
import { ZoomStage } from "./ZoomStage";
import { AddViewWindow } from "./AddViewWindow";
import { drawPicture } from "./picture";
import type { ViewerModel } from "@/components/dashboard/ModelCanvas";
import type { Body, V3 } from "@/lib/drawing/brep";
import { unpackBody } from "@/lib/drawing/bodyPack";
import { extraView, type Extra, type ExtraView } from "@/lib/drawing/extra";
import { decodeMeshes, type Mesh } from "@/lib/model/mesh";
import { FitPicker, linkTargets, useFitItems, useOpenFitLink, type FitTarget } from "./fit";
import { Notice } from "@/components/ui/Notice";
import { askConfirm } from "@/components/ui/useConfirm";

type Hole = Drawing["holes"][number];
type Snap = { at: Pt; view: string };
type Edge = Drawing["edges"][number];
// A view is picked by its key, like a picture in Google Docs: moved, resized from a corner, turned.
type Item = { id: string; type: "note" | "dim" | "view" };
type Part = "text" | "arrow" | "line" | "move" | "scale" | "rotate";
// What a click on the sheet does next. Notes: where the arrow points, then where the text goes
// (`preset`: a tap or a diameter picked from a hole's menu instead of the side form). Dimensions,
// like Onshape's: two points (corners, line ends, hole centres), or a straight edge and then a
// parallel edge (the distance between them), a point (its distance to the edge) or nothing (the
// edge's length); then where the dimension line goes, which also picks horizontal or vertical.
// Slanted ones are aligned. A hole's edge gives its Ø.
type Mode =
  | { kind: "idle" }
  | { kind: "arrow" }
  | { kind: "text"; leader?: Pt; hole?: Hole; preset?: { text?: string; dia?: boolean } }
  | { kind: "dim1" }
  | { kind: "dim2"; a: Snap }
  | { kind: "dimEdge"; edge: Edge }
  | { kind: "dimPlace"; a: Snap; b: Snap; dir?: DimDir };
// A note or dimension being dragged: a note's text, its arrow tip, or a dimension's line. `off`
// is where it was grabbed, from its anchor. `before`: the edits when the press started (one undo step).
// Resizing a view keeps its far corner `o` still; `diag` is the corner grabbed, from o, at scale `s`.
type Drag = { item: Item; part: Part; off: Pt; pointer: number; moved: boolean; before: DrawingEdits; scale?: { o: Pt; diag: Pt; s: number } };
type Hit = Item & { part: Part; corner?: number };

// Sheet mm around a view's corner or turn handle that grabs it: more on a phone, where the whole
// sheet is a few hundred pixels wide.
const HANDLE = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches ? 7 : 2.6;
// The turn handle: on a short stick above the middle of the view's top edge, as in Google Docs.
const knob = (v: PlacedView): { from: Pt; at: Pt } => {
  const xf = viewXf(v);
  const mid = v.x + (v.w * v.s) / 2;
  return { from: xf.fwd([mid, v.y]), at: xf.fwd([mid, v.y - 8]) };
};
// Free turning snaps to the quarter turns within 5°; Shift snaps every 15° (Harel, 2026-11-21).
function snapTurn(deg: number, fine: boolean) {
  const d = ((deg % 360) + 360) % 360;
  if (fine) return (Math.round(d / 15) * 15) % 360;
  const q = Math.round(d / 90) * 90;
  return Math.abs(d - q) <= 5 ? q % 360 : Math.round(d * 10) / 10;
}

type Draft = { kind: "fit" | "screw" | "none"; fit: Fit; target: FitTarget | null; screw: string; extra: string };
const NEW_DRAFT: Draft = { kind: "fit", fit: DEFAULT_FIT, target: null, screw: "M5", extra: "" };

// The note's words: the fit or the tapped screw, then whatever the member typed.
function draftText(d: Draft, hole?: Hole) {
  const target = d.target?.name;
  const head =
    d.kind === "fit" && target ? `${d.fit} fit for\n${target}${hole ? `\nØ${fmt(hole.d)}` : ""}` : d.kind === "screw" ? `${d.screw} tapped` : "";
  return [head, d.extra.trim()].filter(Boolean).join("\n");
}

// The point on a hole's edge facing `toward`.
const onEdge = (hole: Hole, toward: Pt): Pt => {
  const [dx, dy] = [toward[0] - hole.at[0], toward[1] - hole.at[1]];
  const l = Math.hypot(dx, dy) || 1;
  return [hole.at[0] + (dx / l) * hole.r, hole.at[1] + (dy / l) * hole.r];
};
// A record without one key.
const without = <T,>(m: Record<string, T> | undefined, id: string): Record<string, T> => Object.fromEntries(Object.entries(m ?? {}).filter(([k]) => k !== id));
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const minus = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
function segDist(p: Pt, a: Pt, b: Pt) {
  const [dx, dy] = minus(b, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

const axisAligned = (a: Pt, b: Pt) => Math.abs(b[0] - a[0]) < 0.05 || Math.abs(b[1] - a[1]) < 0.05;
// The point of the line through a and b nearest p, and whether it lies between a and b.
function project(p: Pt, a: Pt, b: Pt): { at: Pt; inside: boolean } {
  const [dx, dy] = minus(b, a);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1);
  return { at: [a[0] + t * dx, a[1] + t * dy], inside: t >= 0 && t <= 1 };
}
const sameEdge = (e: Edge, f: Edge) => dist(e.a, f.a) + dist(e.b, f.b) < 0.01 || dist(e.a, f.b) + dist(e.b, f.a) < 0.01;
// Parallel and apart (not two pieces of one straight line).
function parallelEdges(e: Edge, f: Edge) {
  const [u, v] = [minus(e.b, e.a), minus(f.b, f.a)];
  const cross = (u[0] * v[1] - u[1] * v[0]) / ((Math.hypot(...u) || 1) * (Math.hypot(...v) || 1));
  return Math.abs(cross) < 0.01 && dist(project(f.a, e.a, e.b).at, f.a) > 0.05;
}
// The two points a distance between parallel edges runs between: across from the middle of
// the second edge, moved onto the middle of the first when that falls outside it.
function acrossEdges(e: Edge, f: Edge): [Pt, Pt] {
  const mid: Pt = [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2];
  const onE = project(mid, e.a, e.b);
  const a: Pt = onE.inside ? onE.at : [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
  return [a, project(a, f.a, f.b).at];
}

// Horizontal or vertical, from where the pointer is, as Onshape does: above or below the two
// points → horizontal; left or right of them → vertical. Points in line allow only one.
function chooseDir(a: Pt, b: Pt, p: Pt): "h" | "v" {
  if (Math.abs(b[0] - a[0]) < 0.05) return "v";
  if (Math.abs(b[1] - a[1]) < 0.05) return "h";
  const outX = Math.max(Math.min(a[0], b[0]) - p[0], 0, p[0] - Math.max(a[0], b[0]));
  const outY = Math.max(Math.min(a[1], b[1]) - p[1], 0, p[1] - Math.max(a[1], b[1]));
  return outY >= outX ? "h" : "v";
}

const HINTS: Record<Mode["kind"], string | null> = {
  idle: null,
  arrow: "Click where the arrow points (a hole, or anywhere)",
  text: "Click where the text goes",
  dim1: "Click a corner, a line end, a hole centre, a straight edge, or a hole's edge for its Ø",
  dim2: "Click the second point",
  dimEdge: "Click a parallel line (distance between them), a point (distance to the line), or where the line's length goes",
  dimPlace: "Click where the dimension goes (above / below: horizontal, beside: vertical)",
};

const DIM_LABELS: Record<string, string> = {
  "dim:thickness": "Thickness",
  "dim:length": "Length",
  "dim:width": "Width",
  "dim:height": "Height",
  "dim:wall": "Wall",
  "dim:flats": "Across flats",
  "dim:od": "Outer Ø",
  "dim:id": "Inner Ø",
};
const VIEW_LABELS: Record<string, string> = { front: "Front", side: "Side", end: "End", long: "Long side" };
const NOTE_LABELS: Record<Note["kind"], string> = { tap: "Tap", fit: "Fit", bore: "Bore", tool: "Max tool", size: "Size", dia: "Diameter", custom: "Note" };

// A note's text box on the sheet; the tool note is drawn bigger (svg.ts).
function textRect(n: Note) {
  const { rect } = noteBox(n.text, n.at);
  if (n.kind !== "tool" || n.leader) return rect;
  const k = 5 / 3.5;
  return { x0: rect.x0, y0: n.at[1] - 5, x1: rect.x0 + (rect.x1 - rect.x0) * k, y1: rect.y1 };
}
// A dimension's text and line together.
function dimBox(d: Dim) {
  const [a, b] = [dimRect(d), dimLine(d)];
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
const inside = (p: Pt, r: { x0: number; y0: number; x1: number; y1: number }, pad = 1) => p[0] >= r.x0 - pad && p[0] <= r.x1 + pad && p[1] >= r.y0 - pad && p[1] <= r.y1 + pad;

// Undo / redo over the edits. `record: false` changes without a step (a drag in progress).
function useHistory() {
  const [edits, setEdits] = useState<DrawingEdits>({});
  const [past, setPast] = useState<DrawingEdits[]>([]);
  const [future, setFuture] = useState<DrawingEdits[]>([]);
  const [dirty, setDirty] = useState(false);
  const change = useCallback(
    (next: DrawingEdits, { record = true, from }: { record?: boolean; from?: DrawingEdits } = {}) => {
      if (record) {
        setPast((p) => [...p.slice(-99), from ?? edits]);
        setFuture([]);
      }
      setEdits(next);
      setDirty(true);
    },
    [edits],
  );
  const undo = () => {
    if (!past.length) return;
    setFuture((f) => [edits, ...f]);
    setEdits(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setDirty(true);
  };
  const redo = () => {
    if (!future.length) return;
    setPast((p) => [...p, edits]);
    setEdits(future[0]);
    setFuture((f) => f.slice(1));
    setDirty(true);
  };
  const reset = (e: DrawingEdits) => {
    setEdits(e);
    setPast([]);
    setFuture([]);
    setDirty(false);
  };
  return { edits, change, undo, redo, reset, canUndo: past.length > 0, canRedo: future.length > 0, dirty, setDirty };
}

async function fetchBody(partId: string): Promise<Body> {
  const res = await fetch(`/api/parts/${partId}/drawing/body`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Couldn't load the part's geometry.");
  return unpackBody(body);
}
async function fetchModel(partId: string): Promise<ViewerModel> {
  const res = await fetch(`/api/parts/${partId}/model`, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as { model?: ViewerModel; error?: string };
  if (!body.model) throw new Error(body.error ?? `The 3D view failed (${res.status}).`);
  return body.model;
}
async function uploadPicture(partId: string, key: string, blob: Blob): Promise<string> {
  const res = await fetch(`/api/parts/${partId}/drawing/picture?key=${key}`, { method: "PUT", headers: { "content-type": "image/png" }, body: blob });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? "Couldn't keep the view's picture.");
  return body.href;
}
// The part's own mesh from its 3D model's file (the file the 3D window just loaded).
async function meshOf(model: ViewerModel): Promise<Mesh> {
  const k = model.placements[0]?.k ?? "";
  const partId = k.slice(k.lastIndexOf(":") + 1);
  const res = await fetch(model.studios[0] ?? "");
  if (!res.ok || !res.body) throw new Error(`The part's 3D file failed (${res.status}).`);
  const buf = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const mesh = decodeMeshes(buf).find((m) => m.partId === partId);
  if (!mesh) throw new Error("The part isn't in its 3D file.");
  return mesh;
}

// The drawing editor (plan/auto-drawings.md): small on purpose. Every automatic note and
// dimension can be retyped, hidden or moved; members add notes (a fit, a tapped screw, plain
// words) and dimensions (Onshape-style: points or an edge, or a hole's Ø). Nothing else.
// `load` / `store` stand in for the part's drawing route on /dev/drawing (no Onshape locally).
export function DrawingEditor({
  partId,
  onClose,
  load = fetchDrawing,
  store,
  loadBody = fetchBody,
  loadModel = fetchModel,
  savePicture = uploadPicture,
}: {
  partId: string;
  onClose: () => void;
  load?: (partId: string) => Promise<DrawingResponse>;
  store?: (edits: DrawingEdits) => Promise<void>;
  // Add view's geometry, 3D model and picture upload; /dev/drawing passes stand-ins.
  loadBody?: (partId: string) => Promise<Body>;
  loadModel?: (partId: string) => Promise<ViewerModel>;
  savePicture?: (partId: string, key: string, blob: Blob) => Promise<string>;
}) {
  const [data, setData] = useState<DrawingResponse | null>(null);
  const h = useHistory();
  const { edits, change } = h;
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [composing, setComposing] = useState(false); // the side form for a new note is open
  // A Fit or a note picked from a hole's menu: the side form fills it in, then Place goes straight
  // to placing its text, the arrow already on that hole.
  const [pendingHole, setPendingHole] = useState<Hole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<"regenerate" | "delete" | null>(null);
  const [loads, setLoads] = useState(0); // bumped by Regenerate to fetch the new drawing
  const sheet = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDialogElement>(null);
  const drag = useRef<Drag | null>(null);
  const swallow = useRef(false);
  const [hover, setHover] = useState<Hit | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [dragging, setDragging] = useState<Part | null>(null); // what a drag in progress holds
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [holeMenu, setHoleMenu] = useState<{ hole: Hole; x: number; y: number } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null); // a double-clicked item: focus its field
  // Added views as made (from the response, then as they're added); edits.extra says which show.
  const [extras, setExtras] = useState<ExtraView[]>([]);
  const [adding, setAdding] = useState<{ model: ViewerModel; body: Body } | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  useEffect(() => frame.current?.showModal(), []);
  const router = useRouter();

  const { reset } = h;
  useEffect(() => {
    load(partId)
      .then((r) => {
        setData(r);
        setExtras(r.extraViews ?? []);
        reset(r.edits ?? {});
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset is stable enough; refetch only on part / Regenerate
  }, [partId, loads]);

  const items = useFitItems();
  const openFitLink = useOpenFitLink();
  // The views where members put them; the edits go on unturned (`flat`), then each view turns.
  const shownExtras = useMemo(() => extras.filter((x) => edits.extra?.some((e) => e.key === x.key)), [extras, edits.extra]);
  const base = useMemo(() => (data ? partDrawing(data.part, data.title, edits.views, shownExtras) : null), [data, edits.views, shownExtras]);
  const flat = useMemo(() => (base ? applyEdits(base, edits) : null), [base, edits]);
  const drawing = useMemo(() => (flat ? turnViews(flat) : null), [flat]);
  // Notes linked to a part or item (picked, or matched by name) open its window when clicked.
  const targets = useMemo(() => linkTargets(data?.fitParts ?? [], items), [data, items]);
  const linked = useMemo(() => (drawing ? linkNotes(drawing, targets) : null), [drawing, targets]);
  const svg = useMemo(() => (linked ? drawingSvg(linked, { live: true }) : ""), [linked]);

  const added = edits.added ?? [];
  const addedDims = edits.dims ?? [];
  const hidden = new Set(edits.hidden ?? []);

  function sheetPoint(e: { clientX: number; clientY: number }): Pt | null {
    const box = sheet.current?.getBoundingClientRect();
    if (!box || !drawing) return null;
    return [((e.clientX - box.left) / box.width) * drawing.sheet.w, ((e.clientY - box.top) / box.height) * drawing.sheet.h];
  }
  const holeAt = (p: Pt) => drawing?.holes.find((x) => dist(x.at, p) <= x.r + 3);
  const viewOf = (key?: string) => (key ? drawing?.views.find((v) => v.key === key) : undefined);
  // A sheet point as it sits on the view unturned, where the edits are kept.
  const toFlat = (key: string | undefined, p: Pt): Pt => {
    const v = viewOf(key);
    return v ? viewXf(v).inv(p) : p;
  };
  const flatNote = (id: string) => flat?.notes.find((n) => n.id === id);
  const flatDim = (id: string) => flat?.dims.find((n) => n.id === id);
  // Inside a view's (turned) box.
  const viewAt = (p: Pt) =>
    [...(drawing?.views ?? [])].reverse().find((v) => {
      const q = viewXf(v).inv(p);
      return q[0] >= v.x - 1 && q[0] <= v.x + v.w * v.s + 1 && q[1] >= v.y - 1 && q[1] <= v.y + v.h * v.s + 1;
    });
  const textCentre = (id: string): Pt | undefined => {
    const n = drawing?.notes.find((x) => x.id === id);
    if (!n) return undefined;
    const { rect } = noteBox(n.text, n.at);
    return [(rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2];
  };

  // The point the Dimension tool would take under p: a hole centre or a corner / line end
  // within 2.5 mm, on `view` when given.
  function snapAt(p: Pt, view?: string): Snap | null {
    let best: Snap | null = null;
    let bestD = 2.5;
    for (const s of drawing?.snaps ?? []) {
      if (view && s.view !== view) continue;
      const d = dist(s.at, p) - (s.kind === "center" ? 0.5 : 0); // centres win ties
      if (d < bestD) [best, bestD] = [{ at: s.at, view: s.view }, d];
    }
    return best;
  }
  const edgeAt = (p: Pt) => drawing?.edges.find((e) => segDist(p, e.a, e.b) < 1.2);
  const holeEdgeAt = (p: Pt) => drawing?.holes.find((x) => Math.abs(dist(x.at, p) - x.r) < 1.5 && x.r > 1.5);

  // The note or dimension under a sheet point: arrow tips first (small, often inside a text's
  // reach), then texts, then dimensions.
  function itemAt(p: Pt): Hit | null {
    if (!drawing) return null;
    // The selected view's handles first.
    const sel = selected?.type === "view" ? viewOf(selected.id) : undefined;
    if (sel) {
      if (dist(knob(sel).at, p) <= HANDLE) return { id: sel.key, type: "view", part: "rotate" };
      const corner = viewCorners(sel).findIndex((c) => dist(c, p) <= HANDLE);
      if (corner >= 0) return { id: sel.key, type: "view", part: "scale", corner };
    }
    const tip = drawing.notes.find((n) => n.leader && dist(n.leader, p) <= 2.5);
    if (tip) return { id: tip.id, type: "note", part: "arrow" };
    const box = [...drawing.notes].reverse().find((n) => inside(p, textRect(n)));
    if (box) return { id: box.id, type: "note", part: "text" };
    const dim = [...drawing.dims].reverse().find((d) => dimHit(d, p));
    if (dim) return { id: dim.id, type: "dim", part: "line" };
    const v = viewAt(p);
    return v ? { id: v.key, type: "view", part: "move" } : null;
  }

  const isAddedNote = (id: string) => added.some((a) => a.id === id);
  const isAddedDim = (id: string) => addedDims.some((a) => a.id === id);

  // Place a new note: its arrow tip is kept against the part (and its hole), its text beside it.
  function addNote(text: string, at: Pt, leader: Pt | undefined, hole: Hole | undefined, extra: Partial<NonNullable<DrawingEdits["added"]>[number]> = {}) {
    if (!drawing) return;
    const ref = leader ? sheetToRef(drawing, leader, hole ? { hole: hole.id } : {}) : null;
    const id = `note:${Date.now()}`;
    const flatAt = ref ? toFlat(ref.v, at) : at;
    change({
      ...edits,
      added: [...added, { id, text, at: flatAt, ...(leader ? { leader } : {}), ...(ref ? { ref, off: minus(flatAt, toFlat(ref.v, leader!)) } : {}), ...extra }],
    });
    setSelected({ id, type: "note" });
  }

  function onSheetClick(e: React.MouseEvent) {
    if (swallow.current) {
      swallow.current = false;
      return;
    }
    const at = sheetPoint(e);
    if (!at || !drawing) return;
    setHoleMenu(null);
    if (mode.kind === "idle") {
      const hit = itemAt(at);
      // A click on a hole inside a view still offers its notes; elsewhere on a view selects it.
      const overHole = hit?.type === "view" && hit.part === "move" ? holeAt(at) : undefined;
      if (hit && !overHole) {
        setSelected({ id: hit.id, type: hit.type });
        // A click (not a drag) on a note linked to a part or item opens its window.
        const link = hit.part === "text" ? linked?.notes.find((n) => n.id === hit.id)?.link : undefined;
        if (link) openFitLink.open(link);
        return;
      }
      setSelected(null);
      // A click on a hole offers what can be noted on it.
      const hole = holeAt(at);
      const box = frame.current?.getBoundingClientRect();
      if (hole && box) setHoleMenu({ hole, x: e.clientX - box.left, y: e.clientY - box.top });
      return;
    }
    if (mode.kind === "arrow") {
      const hole = holeAt(at);
      setMode(hole ? { kind: "text", hole } : { kind: "text", leader: at });
      return;
    }
    if (mode.kind === "text") {
      const leader = mode.hole ? onEdge(mode.hole, at) : mode.leader;
      if (mode.preset?.dia) addNote("", at, leader, mode.hole, { dia: true });
      else if (mode.preset?.text) addNote(mode.preset.text, at, leader, mode.hole);
      else {
        const t = draft.kind === "fit" ? draft.target : null;
        const link = t ? { fitTargetName: t.name, ...(t.kind === "part" ? { fitPartId: t.id } : { fitInventoryItemId: t.id }) } : {};
        addNote(draftText(draft, mode.hole), at, leader, mode.hole, link);
        setDraft({ ...draft, extra: "" });
        setComposing(false);
      }
      setMode({ kind: "idle" });
      return;
    }
    if (mode.kind === "dim1") {
      const snap = snapAt(at);
      if (snap) return setMode({ kind: "dim2", a: snap });
      const rim = holeEdgeAt(at);
      if (rim) return setMode({ kind: "text", hole: rim, preset: { dia: true } });
      const edge = edgeAt(at);
      if (edge) return setMode({ kind: "dimEdge", edge });
      return;
    }
    if (mode.kind === "dimEdge") {
      const e = mode.edge;
      const view = e.view;
      const other = drawing.edges.find((f) => f.view === view && !sameEdge(e, f) && segDist(at, f.a, f.b) < 1.2 && parallelEdges(e, f));
      const snap = other ? null : snapAt(at, view);
      let pair: [Pt, Pt] | null = null;
      if (other) pair = acrossEdges(e, other);
      else if (snap && segDist(snap.at, e.a, e.b) > 0.05) pair = [snap.at, project(snap.at, e.a, e.b).at];
      if (pair) {
        const dir: DimDir | undefined = axisAligned(toFlat(view, pair[0]), toFlat(view, pair[1])) ? undefined : "a";
        return setMode({ kind: "dimPlace", a: { at: pair[0], view }, b: { at: pair[1], view }, ...(dir ? { dir } : {}) });
      }
      // Nothing to measure to: the edge's own length, placed here.
      const [fa, fb] = [toFlat(view, e.a), toFlat(view, e.b)];
      return createDim({ at: e.a, view }, { at: e.b, view }, axisAligned(fa, fb) ? chooseDir(fa, fb, toFlat(view, at)) : "a", at);
    }
    if (mode.kind === "dim2") {
      const snap = snapAt(at, mode.a.view);
      if (snap && dist(snap.at, mode.a.at) > 0.05) setMode({ kind: "dimPlace", a: mode.a, b: snap });
      return;
    }
    if (mode.kind === "dimPlace") {
      const v = mode.a.view;
      createDim(mode.a, mode.b, mode.dir ?? chooseDir(toFlat(v, mode.a.at), toFlat(v, mode.b.at), toFlat(v, at)), at);
    }
  }

  // Where a dimension's line goes for the pointer at p: y or x for horizontal / vertical, the
  // distance beside the a-b line for aligned (in dimFrame's own sense of beside).
  const lineAtFor = (a: Pt, b: Pt, dir: DimDir, p: Pt) => (dir === "h" ? p[1] : dir === "v" ? p[0] : dimFrame({ id: "", a, b, dir, at: 0, text: "" }).local(p)[1]);

  // `dir` is in the view's own unturned frame, where the dimension is kept.
  function createDim(a: Snap, b: Snap, dir: DimDir, p: Pt) {
    if (!drawing) return;
    const [ra, rb] = [sheetToRef(drawing, a.at, { view: a.view }), sheetToRef(drawing, b.at, { view: a.view })];
    if (!ra || !rb) return;
    const id = `dim:${Date.now()}`;
    const [fa, fb] = [toFlat(a.view, a.at), toFlat(a.view, b.at)];
    const lineAt = lineAtFor(fa, fb, dir, toFlat(a.view, p));
    const off = dir === "a" ? lineAt : dimOff(fa, fb, dir, lineAt);
    change({ ...edits, dims: [...addedDims, { id, a: ra, b: rb, dir, off }] });
    setSelected({ id, type: "dim" });
    setMode({ kind: "dim1" }); // keep dimensioning, as Onshape does, until Esc
  }

  // Dragging writes the move as a shift from where the drawing put the item, or for added items
  // against the part, so it survives the drawing being made again.
  function moveTo(d: Drag, sheetP: Pt, fine = false) {
    if (!base || !drawing) return;
    const id = d.item.id;
    const opts = { record: false };
    if (d.item.type === "view") return moveView(d, sheetP, fine);
    if (d.item.type === "dim") {
      const shown = flatDim(id);
      if (!shown) return;
      const p = toFlat(shown.view, sheetP);
      // Across the line moves the line; along it slides the text (back home within 2 mm).
      const f = dimFrame(shown);
      const [along, across] = f.local(p);
      const lineAt = across - d.off[1];
      let tx = along - d.off[0] - f.home;
      if (Math.abs(tx) < 2) tx = 0;
      if (isAddedDim(id)) {
        const off = shown.dir === "a" ? lineAt : dimOff(shown.a, shown.b, shown.dir, lineAt);
        return change({ ...edits, dims: addedDims.map((x) => (x.id === id ? { ...x, off, tx } : x)) }, opts);
      }
      const auto = base.dims.find((x) => x.id === id);
      if (!auto) return;
      const delta = lineAt - auto.at;
      return change({ ...edits, shift: { ...edits.shift, [id]: shown.dir === "h" ? [tx, delta] : [delta, tx] } }, opts);
    }
    const fn = flatNote(id);
    if (d.part === "text") {
      const p = toFlat(fn?.view, sheetP);
      const at: Pt = [p[0] - d.off[0], p[1] - d.off[1]];
      const a = added.find((x) => x.id === id);
      if (a) return change({ ...edits, added: added.map((x) => (x.id === id ? { ...x, at, ...(x.ref && x.leader ? { off: minus(at, fn?.leader ?? x.leader) } : {}) } : x)) }, opts);
      const auto = base.notes.find((x) => x.id === id);
      if (!auto) return;
      return change({ ...edits, moved: without(edits.moved, id), shift: { ...edits.shift, [id]: minus(at, auto.at) } }, opts);
    }
    // The arrow tip, snapped onto a hole's edge when over one.
    const hole = holeAt(sheetP);
    const from = textCentre(id);
    const tip = hole && from ? onEdge(hole, from) : sheetP;
    const ref: DrawingRef | null = sheetToRef(drawing, tip, hole ? { hole: hole.id } : {});
    const a = added.find((x) => x.id === id);
    if (a) {
      const at = fn?.at ?? a.at;
      return change({ ...edits, added: added.map((x) => (x.id === id ? { ...x, leader: tip, at, ...(ref ? { ref, off: minus(at, toFlat(ref.v, tip)) } : { ref: undefined, off: undefined }) } : x)) }, opts);
    }
    const arrows = without(edits.arrows, id);
    if (ref) change({ ...edits, arrows, tips: { ...edits.tips, [id]: ref } }, opts);
    else change({ ...edits, arrows: { ...edits.arrows, [id]: tip } }, opts);
  }

  // A view dragged by its middle, a corner (resize, proportions kept, the far corner still) or its
  // turn handle. Its centre, scale and turn are kept by view key (edits.views).
  function moveView(d: Drag, p: Pt, fine: boolean) {
    const v = viewOf(d.item.id);
    if (!v) return;
    const xf = viewXf(v);
    let next = { cx: xf.c[0], cy: xf.c[1], s: v.s, ...(v.r ? { r: v.r } : {}) };
    if (d.part === "move") next = { ...next, cx: p[0] - d.off[0], cy: p[1] - d.off[1] };
    else if (d.part === "scale" && d.scale) {
      const { o, diag, s } = d.scale;
      const k = Math.max(0.05 / s, ((p[0] - o[0]) * diag[0] + (p[1] - o[1]) * diag[1]) / (diag[0] ** 2 + diag[1] ** 2 || 1));
      next = { ...next, s: Math.round(s * k * 1000) / 1000, cx: o[0] + (diag[0] * k) / 2, cy: o[1] + (diag[1] * k) / 2 };
    } else if (d.part === "rotate") {
      const r = snapTurn((Math.atan2(p[1] - xf.c[1], p[0] - xf.c[0]) * 180) / Math.PI + 90, fine);
      next = { cx: next.cx, cy: next.cy, s: next.s, ...(r ? { r } : {}) };
    }
    change({ ...edits, views: { ...edits.views, [v.key]: next } }, { record: false });
  }

  function onSheetPointerDown(e: React.PointerEvent) {
    // A new press: a drag that ended without its click (released off the sheet) mustn't eat this one.
    swallow.current = false;
    if (e.button !== 0 || mode.kind !== "idle" || !drawing) return;
    const p = sheetPoint(e);
    const hit = p && itemAt(p);
    if (!p || !hit) return;
    e.stopPropagation(); // no pan
    e.preventDefault();
    sheet.current?.setPointerCapture(e.pointerId);
    let off: Pt = [0, 0];
    let scale: Drag["scale"];
    if (hit.part === "text") {
      const n = flatNote(hit.id)!;
      off = minus(toFlat(n.view, p), n.at);
    }
    if (hit.part === "line") {
      // Where it was grabbed, in the dimension's own frame: along from its text, across from its line.
      const dm = flatDim(hit.id)!;
      const f = dimFrame(dm);
      const [along, across] = f.local(toFlat(dm.view, p));
      off = [along - f.tc, across - f.at];
    }
    const v = hit.type === "view" ? viewOf(hit.id) : undefined;
    if (v && hit.part === "move") off = minus(p, viewXf(v).c);
    if (v && hit.part === "scale") {
      const cs = viewCorners(v);
      const o = cs[(hit.corner! + 2) % 4];
      scale = { o, diag: minus(cs[hit.corner!], o), s: v.s };
    }
    drag.current = { item: { id: hit.id, type: hit.type }, part: hit.part, off, pointer: e.pointerId, moved: false, before: edits, ...(scale ? { scale } : {}) };
    setHover(hit);
  }
  function onSheetPointerMove(e: React.PointerEvent) {
    const p = sheetPoint(e);
    if (!p) return;
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) {
      setPointer(p);
      if (mode.kind === "idle" && !e.buttons) {
        const hit = itemAt(p);
        if (hit?.id !== hover?.id || hit?.part !== hover?.part || hit?.corner !== hover?.corner) setHover(hit);
      }
      return;
    }
    if (!d.moved) {
      d.moved = true;
      setDragging(d.part);
      setSelected(d.item);
      change(edits, { from: d.before }); // one undo step for the whole drag
    }
    moveTo(d, p, e.shiftKey);
  }
  function onSheetPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    setDragging(null);
    if (d.moved) swallow.current = true;
  }

  // Hide an automatic item, delete an added one.
  const isExtra = (key: string) => !!edits.extra?.some((x) => x.key === key);
  const remove = (it: Item) => {
    // An added view goes (its dimensions and notes with it); the drawing's own views stay.
    if (it.type === "view") {
      if (isExtra(it.id)) {
        change({ ...edits, extra: edits.extra!.filter((x) => x.key !== it.id), views: without(edits.views, it.id) });
        setSelected(null);
      }
      return;
    }
    if (it.type === "dim" && isAddedDim(it.id)) change({ ...edits, dims: addedDims.filter((x) => x.id !== it.id) });
    else if (it.type === "note" && isAddedNote(it.id)) change({ ...edits, added: added.filter((x) => x.id !== it.id) });
    else change({ ...edits, hidden: [...new Set([...(edits.hidden ?? []), it.id])] });
    setSelected(null);
  };
  const resetView = (key: string) => change({ ...edits, views: without(edits.views, key) });
  const toggle = (id: string) => change({ ...edits, hidden: hidden.has(id) ? [...hidden].filter((x) => x !== id) : [...hidden, id] });
  const retype = (it: Item, t: string) => {
    if (it.type === "note" && isAddedNote(it.id)) change({ ...edits, added: added.map((x) => (x.id === it.id ? { ...x, text: t } : x)) });
    else if (it.type === "dim" && isAddedDim(it.id)) change({ ...edits, dims: addedDims.map((x) => (x.id === it.id ? { ...x, text: t } : x)) });
    else change({ ...edits, text: { ...edits.text, [it.id]: t } });
  };
  // Back to what the drawing made: its words and its place.
  const restore = (id: string) => {
    const strip = <T,>(m: Record<string, T> | undefined) => without(m, id);
    change({ ...edits, text: strip(edits.text), shift: strip(edits.shift), moved: strip(edits.moved), arrows: strip(edits.arrows), tips: strip(edits.tips) });
  };
  const edited = (id: string) => [edits.text, edits.shift, edits.moved, edits.arrows, edits.tips].some((m) => m && id in m);

  // Add view: the part's kept geometry and its 3D model, then the window.
  async function openAddView() {
    setAddBusy(true);
    setError(null);
    try {
      const [body, model] = await Promise.all([loadBody(partId), loadModel(partId)]);
      setAdding({ body, model });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddBusy(false);
    }
  }
  // A straight view is made from the geometry; an angled one drawn as a picture and kept.
  async function addView(dir: V3, right: V3) {
    if (!adding || !base) return;
    setAddBusy(true);
    setError(null);
    try {
      const key = `add${Date.now().toString(36)}`;
      const s = base.views[0]?.s ?? 1;
      let x: Extra = { key, dir, right };
      let shown = extraView(adding.body, x);
      if (!shown) {
        const pic = await drawPicture(await meshOf(adding.model), adding.body, dir, right, s);
        const href = await savePicture(partId, key, pic.blob);
        x = { ...x, pic: { w: pic.w, h: pic.h, rev: data?.rev ?? null } };
        shown = { key, view: { w: pic.w, h: pic.h, lines: [], holes: [] }, href };
      }
      const view = shown;
      setExtras((list) => [...list, view]);
      change({ ...edits, extra: [...(edits.extra ?? []), x], views: { ...edits.views, [key]: { cx: base.sheet.w / 2, cy: base.sheet.h / 2 - 10, s } } });
      setSelected({ id: key, type: "view" });
      setAdding(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddBusy(false);
    }
  }
  // Angled views drawn from an older version of the part: drawn again from the same angle.
  const stalePictures = (edits.extra ?? []).filter((x) => x.pic && data?.rev && x.pic.rev !== data.rev);
  async function redrawPictures() {
    if (!base) return;
    setAddBusy(true);
    setError(null);
    try {
      const [body, model] = await Promise.all([loadBody(partId), loadModel(partId)]);
      const mesh = await meshOf(model);
      const redrawn = new Map<string, { x: Extra; view: ExtraView }>();
      for (const x of stalePictures) {
        const s = edits.views?.[x.key]?.s ?? base.views[0]?.s ?? 1;
        const pic = await drawPicture(mesh, body, x.dir, x.right, s);
        const href = await savePicture(partId, x.key, pic.blob);
        redrawn.set(x.key, { x: { ...x, pic: { w: pic.w, h: pic.h, rev: data?.rev ?? null } }, view: { key: x.key, view: { w: pic.w, h: pic.h, lines: [], holes: [] }, href } });
      }
      setExtras((list) => list.map((v) => redrawn.get(v.key)?.view ?? v));
      change({ ...edits, extra: (edits.extra ?? []).map((x) => redrawn.get(x.key)?.x ?? x) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAddBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    if (store) {
      await store(edits);
      setSaving(false);
      return h.setDirty(false);
    }
    const res = await fetch(`/api/parts/${partId}/drawing`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(edits) });
    setSaving(false);
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn't save.");
    else h.setDirty(false);
  }

  // Make the drawing again from Onshape. Saved edits are kept; unsaved ones are lost.
  async function regenerate() {
    if (h.dirty && !(await askConfirm({ title: "Regenerate without saving your changes?", body: "Your unsaved edits are lost.", confirm: "Regenerate", danger: true }))) return;
    setBusy("regenerate");
    setError(null);
    const res = await fetch(`/api/parts/${partId}/drawing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: true }) });
    setBusy(null);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't regenerate the drawing.");
    setLoads((n) => n + 1);
    router.refresh();
  }

  async function deleteDrawing() {
    if (!(await askConfirm({ title: "Delete this drawing and its notes?", confirm: "Delete", danger: true }))) return;
    setBusy("delete");
    setError(null);
    const res = await fetch(`/api/parts/${partId}/drawing`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't delete the drawing.");
    router.refresh();
    onClose();
  }

  const close = async () => {
    if (!h.dirty || (await askConfirm({ title: "Close without saving your changes?", body: "Your unsaved edits are lost.", confirm: "Discard", danger: true }))) onClose();
  };

  // Keys: Esc steps back, D dimension, N note, Delete hides / deletes, Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z), Ctrl+S.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (h.dirty && !saving) void save();
      return;
    }
    if (typing || adding) return; // Add view's window has its own keys
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) h.redo();
      else h.undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      h.redo();
    } else if (mod) return;
    else if (e.key === "Escape") {
      // The dialog's own Esc (cancel) closes the editor only when nothing is in progress.
      if (mode.kind !== "idle" || holeMenu || selected) {
        e.preventDefault();
        setMode({ kind: "idle" });
        setHoleMenu(null);
        setSelected(null);
      }
    } else if (e.key === "d" || e.key === "D") setMode({ kind: "dim1" });
    else if (e.key === "n" || e.key === "N") setComposing(true);
    else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      remove(selected);
    }
  };
  useEffect(() => {
    keys.current = onKey;
  });
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, []);

  const hint = HINTS[mode.kind];
  const busyMode = mode.kind !== "idle";
  const canAdd = !!draftText(draft).trim();

  // What follows the pointer while placing: the dimension being made, or the note's arrow and text.
  function preview(): string {
    if (!pointer || !drawing) return "";
    // A first edge alone previews its own length, until the pointer is over something to measure to.
    const fromEdge =
      mode.kind === "dimEdge" && !hoverTarget
        ? { a: { at: mode.edge.a, view: mode.edge.view }, b: { at: mode.edge.b, view: mode.edge.view }, dir: axisAligned(toFlat(mode.edge.view, mode.edge.a), toFlat(mode.edge.view, mode.edge.b)) ? undefined : ("a" as const) }
        : null;
    const placing = mode.kind === "dimPlace" ? mode : fromEdge;
    if (placing) {
      // Worked out on the view unturned, then turned with it.
      const v = placing.a.view;
      const [fa, fb, fp] = [toFlat(v, placing.a.at), toFlat(v, placing.b.at), toFlat(v, pointer)];
      const dir = placing.dir ?? chooseDir(fa, fb, fp);
      const text = fmt(measure(drawing, v, fa, fb, dir));
      const dim: Dim = { id: "preview", a: fa, b: fb, dir, at: lineAtFor(fa, fb, dir, fp), text };
      const pv = viewOf(v);
      return dimension(pv ? turnDim(dim, viewXf(pv)) : dim);
    }
    if (mode.kind === "text") {
      const leader = mode.hole ? onEdge(mode.hole, pointer) : mode.leader;
      const text = mode.preset?.dia ? `Ø${fmt(mode.hole?.d ?? 0)}` : (mode.preset?.text ?? (draftText(draft, mode.hole) || "Note"));
      return noteSvg({ id: "preview", kind: "custom", text, at: pointer, ...(leader ? { leader } : {}) }, false);
    }
    return "";
  }
  // After a first edge: the parallel edge or the point under the pointer that the next click takes.
  const parallelShown =
    pointer && mode.kind === "dimEdge" ? drawing?.edges.find((f) => f.view === mode.edge.view && !sameEdge(mode.edge, f) && segDist(pointer, f.a, f.b) < 1.2 && parallelEdges(mode.edge, f)) : undefined;
  const snapShown =
    pointer && (mode.kind === "dim1" || mode.kind === "dim2" || (mode.kind === "dimEdge" && !parallelShown))
      ? snapAt(pointer, mode.kind === "dim2" ? mode.a.view : mode.kind === "dimEdge" ? mode.edge.view : undefined)
      : null;
  const pointShown = mode.kind === "dimEdge" && snapShown && segDist(snapShown.at, mode.edge.a, mode.edge.b) > 0.05 ? snapShown : null;
  const hoverTarget = parallelShown ?? pointShown;
  const edgeShown = pointer && mode.kind === "dim1" && !snapShown ? (holeEdgeAt(pointer) ? null : edgeAt(pointer)) : (parallelShown ?? null);
  const rimShown = pointer && mode.kind === "dim1" && !snapShown ? holeEdgeAt(pointer) : null;

  const outline = (it: Item | null, strong: boolean) => {
    if (!it || !drawing) return null;
    if (it.type === "view") {
      const v = viewOf(it.id);
      if (!v) return null;
      const cs = viewCorners(v);
      return <polygon points={cs.map((c) => c.join(",")).join(" ")} fill="none" stroke={strong ? "#2563EB" : "#38BDF8"} strokeWidth={0.3} strokeDasharray={strong ? "1.2 0.8" : undefined} />;
    }
    const r = it.type === "note" ? (() => {
      const n = drawing.notes.find((x) => x.id === it.id);
      return n && textRect(n);
    })() : (() => {
      const d = drawing.dims.find((x) => x.id === it.id);
      return d && dimBox(d);
    })();
    if (!r) return null;
    return <rect x={r.x0 - 1} y={r.y0 - 1} width={r.x1 - r.x0 + 2} height={r.y1 - r.y0 + 2} rx={0.8} fill={strong ? "rgba(249,115,22,0.10)" : "rgba(56,189,248,0.10)"} stroke={strong ? "#F97316" : "#38BDF8"} strokeWidth={0.3} />;
  };

  const hoverCursor =
    hover?.part === "move" ? "cursor-move" : hover?.part === "scale" ? (hover.corner! % 2 ? "cursor-nesw-resize" : "cursor-nwse-resize") : hover ? "cursor-grab" : "cursor-default";
  const cursor = dragging ? (dragging === "scale" ? hoverCursor : "cursor-grabbing") : busyMode ? "cursor-crosshair" : hoverCursor;
  // The selected view's dotted box, corner handles and turn handle (Google Docs' picture handles).
  const selView = mode.kind === "idle" && selected?.type === "view" ? viewOf(selected.id) : undefined;
  const handles = () => {
    if (!selView) return null;
    const k = knob(selView);
    const corner = viewCorners(selView)[1];
    return (
      <g>
        {isExtra(selView.key) && (
          <g className="pointer-events-auto cursor-pointer" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => (e.stopPropagation(), remove({ id: selView.key, type: "view" }))}>
            <title>Delete this view</title>
            <circle cx={corner[0] + 3.2} cy={corner[1] - 3.2} r={2} fill="#E11D48" />
            <path d={`M${corner[0] + 2.3} ${corner[1] - 4.1}l1.8 1.8m0 -1.8l-1.8 1.8`} stroke="#fff" strokeWidth={0.4} strokeLinecap="round" />
          </g>
        )}
        <line x1={k.from[0]} y1={k.from[1]} x2={k.at[0]} y2={k.at[1]} stroke="#2563EB" strokeWidth={0.3} />
        <circle cx={k.at[0]} cy={k.at[1]} r={1.4} fill="#fff" stroke="#2563EB" strokeWidth={0.35} />
        {viewCorners(selView).map((c, i) => (
          <rect key={i} x={c[0] - 1.1} y={c[1] - 1.1} width={2.2} height={2.2} fill="#2563EB" stroke="#fff" strokeWidth={0.25} transform={`rotate(${selView.r ?? 0} ${c[0]} ${c[1]})`} />
        ))}
      </g>
    );
  };

  // On document.body: inside the part card, pressing the sheet would scale the card (:active) and
  // pull the fixed editor into it. Clicks still bubble through React, so they stop here. A modal
  // <dialog>, so it opens above the part's details window it can be opened from.
  return createPortal(
    <dialog
      ref={frame}
      aria-label="Drawing editor"
      onCancel={(e) => {
        e.preventDefault();
        if (mode.kind === "idle" && !holeMenu && !selected) close();
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="modal-enter m-0 h-dvh max-h-none w-screen max-w-none flex-col border-0 bg-[#07090E]/95 p-3 text-fg backdrop-blur open:flex sm:p-5"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 basis-full truncate text-lg font-semibold text-white sm:flex-1 sm:basis-auto">{data?.title.name ?? "Drawing"}</h2>
        <button className="btn" onClick={regenerate} disabled={!data || !!busy} title="Make it again from Onshape (keeps saved notes and dimensions)">
          {busy === "regenerate" ? "Regenerating…" : "Regenerate"}
        </button>
        <button className="btn text-rose-600" onClick={deleteDrawing} disabled={!data || !!busy}>
          {busy === "delete" ? "Deleting…" : "Delete"}
        </button>
        <button className="btn" onClick={() => downloadDrawing(partId, "pdf").catch((e: Error) => setError(e.message))} disabled={!drawing || h.dirty} title={h.dirty ? "Save first" : undefined}>
          PDF
        </button>
        <button className="btn-primary" onClick={save} disabled={!h.dirty || saving} title="Ctrl+S">
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="press rounded-md p-2 text-white/70 hover:text-white" onClick={close} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>

      {/* The tools, as in Onshape's drawing toolbar: only the few this editor has. */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-sm">
        <ToolButton on={mode.kind === "idle" && !composing} onClick={() => (setMode({ kind: "idle" }), setComposing(false))} title="Select and move (Esc)">
          Select
        </ToolButton>
        <ToolButton on={mode.kind.startsWith("dim")} onClick={() => (setMode({ kind: "dim1" }), setComposing(false), setSelected(null))} title="Dimension (D)">
          Dimension
        </ToolButton>
        <ToolButton on={composing || mode.kind === "arrow" || (mode.kind === "text" && !mode.preset)} onClick={() => (setComposing(true), setMode({ kind: "idle" }))} title="Note (N)">
          Note
        </ToolButton>
        <button className="btn h-8" onClick={openAddView} disabled={!drawing || addBusy || busyMode} title="Add a view of the part from any side">
          {addBusy && !adding ? "Loading…" : "Add view"}
        </button>
        {selected?.type === "view" && isExtra(selected.id) && (
          <button className="btn h-8 text-rose-500" onClick={() => remove(selected)} title="Delete this added view (Delete)">
            Delete view
          </button>
        )}
        <span className="mx-1 h-5 w-px bg-white/15" />
        <button className="btn h-8 px-2" onClick={h.undo} disabled={!h.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
          ↶
        </button>
        <button className="btn h-8 px-2" onClick={h.redo} disabled={!h.canRedo} title="Redo (Ctrl+Y)" aria-label="Redo">
          ↷
        </button>
        {hint && (
          <span className="flex items-center gap-2 text-sky-300">
            {hint}
            {mode.kind === "arrow" && (
              <button className="btn py-0.5 text-xs" onClick={() => setMode({ kind: "text" })} title="Text only, no arrow">
                No arrow
              </button>
            )}
            <button className="btn py-0.5 text-xs" onClick={() => setMode({ kind: "idle" })}>
              Cancel
            </button>
          </span>
        )}
      </div>
      {error && <Notice tone="error" className="mb-2">{error}</Notice>}
      {data?.outdated && <Notice tone="warning" className="mb-2">The part changed in Onshape since this drawing was made. Regenerate it to update.</Notice>}
      {!data?.outdated && stalePictures.length > 0 && (
        <Notice tone="warning" className="mb-2">
          {stalePictures.length > 1 ? "Some angled views show" : "An angled view shows"} an older version of the part.{" "}
          <button className="underline" onClick={redrawPictures} disabled={addBusy}>
            {addBusy ? "Drawing…" : "Draw again"}
          </button>
        </Notice>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {drawing ? (
          // The whole sheet fits without scrollbars; the wheel or a pinch zooms, dragging empty paper pans when zoomed in.
          <ZoomStage aspect={drawing.sheet.w / drawing.sheet.h} className="min-h-[55dvh] flex-1 rounded-lg lg:h-[calc(100dvh-9rem)] lg:min-h-0">
            <div
              ref={sheet}
              onClick={onSheetClick}
              onDoubleClick={(e) => {
                const p = sheetPoint(e);
                const hit = p && mode.kind === "idle" ? itemAt(p) : null;
                if (hit) setFocusId(hit.id);
              }}
              onPointerDown={onSheetPointerDown}
              onPointerMove={onSheetPointerMove}
              onPointerUp={onSheetPointerUp}
              onPointerCancel={onSheetPointerUp}
              onPointerLeave={() => {
                if (!drag.current) setHover(null);
                setPointer(null);
              }}
              className={`relative h-full w-full touch-none select-none bg-white shadow-lg ${cursor}`}
            >
              <div className="h-full w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
              <svg viewBox={`0 0 ${drawing.sheet.w} ${drawing.sheet.h}`} className="pointer-events-none absolute inset-0 h-full w-full">
                {mode.kind === "idle" &&
                  drawing.notes.map(
                    (n) =>
                      n.leader && (
                        <circle
                          key={n.id}
                          cx={n.leader[0]}
                          cy={n.leader[1]}
                          r={hover?.id === n.id && hover.part === "arrow" ? 1.6 : 1.1}
                          fill={hover?.id === n.id && hover.part === "arrow" ? "#0EA5E9" : "rgba(14,165,233,0.25)"}
                          stroke="#0EA5E9"
                          strokeWidth={0.25}
                        />
                      ),
                  )}
                {mode.kind === "idle" && hover && hover.id !== selected?.id && outline(hover, false)}
                {outline(selected, true)}
                {handles()}
                {/* The Dimension tool: what it would pick, the points picked, the dimension being placed. */}
                {mode.kind === "dim2" && <circle cx={mode.a.at[0]} cy={mode.a.at[1]} r={1.2} fill="#F97316" />}
                {mode.kind === "dimEdge" && <line x1={mode.edge.a[0]} y1={mode.edge.a[1]} x2={mode.edge.b[0]} y2={mode.edge.b[1]} stroke="#F97316" strokeWidth={0.8} strokeLinecap="round" />}
                {mode.kind === "dimPlace" && (
                  <>
                    <circle cx={mode.a.at[0]} cy={mode.a.at[1]} r={1.2} fill="#F97316" />
                    <circle cx={mode.b.at[0]} cy={mode.b.at[1]} r={1.2} fill="#F97316" />
                  </>
                )}
                {snapShown && <circle cx={snapShown.at[0]} cy={snapShown.at[1]} r={1.5} fill="rgba(14,165,233,0.3)" stroke="#0EA5E9" strokeWidth={0.3} />}
                {edgeShown && <line x1={edgeShown.a[0]} y1={edgeShown.a[1]} x2={edgeShown.b[0]} y2={edgeShown.b[1]} stroke="#0EA5E9" strokeWidth={0.8} strokeLinecap="round" />}
                {rimShown && <circle cx={rimShown.at[0]} cy={rimShown.at[1]} r={rimShown.r} fill="none" stroke="#0EA5E9" strokeWidth={0.8} />}
                <g opacity={0.75} fill="#0369A1" dangerouslySetInnerHTML={{ __html: preview() }} />
              </svg>
            </div>
          </ZoomStage>
        ) : (
          <div className="min-h-0 flex-1">{!error && <p className="text-sm text-white/60">Loading the drawing…</p>}</div>
        )}

        <aside className="w-full shrink-0 space-y-3 overflow-auto rounded-lg border border-white/10 bg-[#0D111A] p-3 text-sm text-white lg:w-80">
          {composing && (
            <NoteForm
              draft={draft}
              parts={data?.fitParts ?? []}
              onChange={setDraft}
              onHole={!!pendingHole}
              onPlace={() => {
                setMode(pendingHole ? { kind: "text", hole: pendingHole } : { kind: "arrow" });
                setPendingHole(null);
              }}
              onCancel={() => (setComposing(false), setPendingHole(null), setMode({ kind: "idle" }))}
              disabled={!drawing || !canAdd}
            />
          )}
          <p className="text-xs text-white/50">
            Click a hole to note it. Drag any note, arrow tip or dimension to move it; double-click to retype it. Click a view to select it, then drag it, a corner to resize or the round handle to turn it (Shift: 15° steps). The wheel or a pinch zooms; drag empty paper to pan.
          </p>
          {base && drawing && (
            <>
              {Object.keys(edits.views ?? {}).length > 0 && (
                <Section title="Views moved">
                  {drawing.views
                    .filter((v) => edits.views?.[v.key])
                    .map((v) => (
                      <div key={v.key} className={`flex items-center gap-2 rounded-md border p-2 text-xs ${selected?.id === v.key ? "border-orange-400/70" : "border-white/10"}`} onClick={() => setSelected({ id: v.key, type: "view" })}>
                        <span className="flex-1 font-medium text-white/70">
                          {VIEW_LABELS[v.key.replace(/\d+$/, "")] ?? (v.href ? "Angled view" : "Added view")} <span className="tabular-nums text-white/40">{fmt(v.s)}:1{v.r ? ` · ${fmt(v.r)}°` : ""}</span>
                        </span>
                        <button className="btn py-0.5 text-xs" onClick={() => resetView(v.key)} title="Back to where the drawing put it">
                          Reset
                        </button>
                      </div>
                    ))}
                </Section>
              )}
              <Section title="Dimensions">
                {base.dims.map((d) => (
                  <ItemRow
                    key={d.id}
                    label={DIM_LABELS[d.id] ?? "Dimension"}
                    value={edits.text?.[d.id] ?? ""}
                    placeholder={d.text}
                    hidden={hidden.has(d.id)}
                    edited={edited(d.id)}
                    selected={selected?.id === d.id}
                    hovered={hover?.id === d.id}
                    focus={focusId === d.id}
                    onFocused={() => setFocusId(null)}
                    onSelect={() => setSelected({ id: d.id, type: "dim" })}
                    onHover={(on) => setHover(on ? { id: d.id, type: "dim", part: "line" } : null)}
                    onText={(t) => retype({ id: d.id, type: "dim" }, t)}
                    onToggle={() => toggle(d.id)}
                    onRestore={() => restore(d.id)}
                  />
                ))}
                {addedDims.map((m) => {
                  const shown = drawing.dims.find((x) => x.id === m.id);
                  return (
                    <ItemRow
                      key={m.id}
                      label="Added dimension"
                      value={m.text ?? ""}
                      placeholder={shown?.text ?? "(its points are gone)"}
                      selected={selected?.id === m.id}
                      hovered={hover?.id === m.id}
                      focus={focusId === m.id}
                      onFocused={() => setFocusId(null)}
                      onSelect={() => setSelected({ id: m.id, type: "dim" })}
                      onHover={(on) => setHover(on ? { id: m.id, type: "dim", part: "line" } : null)}
                      onText={(t) => retype({ id: m.id, type: "dim" }, t)}
                      onDelete={() => remove({ id: m.id, type: "dim" })}
                    />
                  );
                })}
              </Section>
              <Section title="Notes">
                {base.notes.map((n) => (
                  <ItemRow
                    key={n.id}
                    label={NOTE_LABELS[n.kind]}
                    value={edits.text?.[n.id] ?? n.text}
                    multiline
                    hidden={hidden.has(n.id)}
                    edited={edited(n.id)}
                    selected={selected?.id === n.id}
                    hovered={hover?.id === n.id}
                    focus={focusId === n.id}
                    onFocused={() => setFocusId(null)}
                    onSelect={() => setSelected({ id: n.id, type: "note" })}
                    onHover={(on) => setHover(on ? { id: n.id, type: "note", part: "text" } : null)}
                    onText={(t) => retype({ id: n.id, type: "note" }, t)}
                    onToggle={() => toggle(n.id)}
                    onRestore={() => restore(n.id)}
                  />
                ))}
                {added.map((a) => {
                  const shown = drawing.notes.find((x) => x.id === a.id);
                  return (
                    <ItemRow
                      key={a.id}
                      label={a.dia ? "Diameter" : "Added note"}
                      value={a.text}
                      placeholder={a.dia ? shown?.text : undefined}
                      multiline={!a.dia}
                      selected={selected?.id === a.id}
                      hovered={hover?.id === a.id}
                      focus={focusId === a.id}
                      onFocused={() => setFocusId(null)}
                      onSelect={() => setSelected({ id: a.id, type: "note" })}
                      onHover={(on) => setHover(on ? { id: a.id, type: "note", part: "text" } : null)}
                      onText={(t) => retype({ id: a.id, type: "note" }, t)}
                      onDelete={() => remove({ id: a.id, type: "note" })}
                    />
                  );
                })}
              </Section>
            </>
          )}
        </aside>
      </div>

      {adding && <AddViewWindow model={adding.model} busy={addBusy} onAdd={addView} onClose={() => setAdding(null)} />}
      {holeMenu && (
        <HoleMenu
          hole={holeMenu.hole}
          x={holeMenu.x}
          y={holeMenu.y}
          onPick={(pick) => {
            const hole = holeMenu.hole;
            setHoleMenu(null);
            if (pick === "dia") setMode({ kind: "text", hole, preset: { dia: true } });
            else if (pick === "fit" || pick === "note") {
              setDraft({ ...draft, kind: pick === "fit" ? "fit" : "none" });
              setComposing(true);
              setPendingHole(hole);
            } else setMode({ kind: "text", hole, preset: { text: `${pick} tapped` } });
          }}
          onClose={() => setHoleMenu(null)}
        />
      )}
    </dialog>,
    document.body,
  );
}

function ToolButton({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button className={on ? "btn-primary h-8" : "btn h-8"} onClick={onClick} title={title} aria-pressed={on}>
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-white/50">{title}</div>
      {children}
    </div>
  );
}

// One note or dimension in the side list, kept in step with the sheet: hovering either lights
// the other, and a click on the sheet selects the row. An empty field on a dimension shows what
// it measures.
function ItemRow(props: {
  label: string;
  value: string;
  placeholder?: string;
  multiline?: boolean;
  hidden?: boolean;
  edited?: boolean;
  selected: boolean;
  hovered: boolean;
  focus: boolean;
  onFocused: () => void;
  onSelect: () => void;
  onHover: (on: boolean) => void;
  onText: (t: string) => void;
  onToggle?: () => void;
  onRestore?: () => void;
  onDelete?: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  useEffect(() => {
    if (props.selected) row.current?.scrollIntoView({ block: "nearest" });
  }, [props.selected]);
  useEffect(() => {
    if (!props.focus) return;
    field.current?.focus();
    field.current?.select();
    props.onFocused();
  }, [props.focus, props]);
  const cls = "input w-full text-sm";
  return (
    <div
      ref={row}
      onClick={props.onSelect}
      onMouseEnter={() => props.onHover(true)}
      onMouseLeave={() => props.onHover(false)}
      className={`space-y-1 rounded-md border p-2 ${props.selected ? "border-orange-400/70 bg-orange-400/5" : props.hovered ? "border-sky-400/50" : "border-white/10"} ${props.hidden ? "opacity-50" : ""}`}
    >
      <div className="flex items-center gap-1.5 text-xs">
        <span className="flex-1 font-medium text-white/70">{props.label}</span>
        {props.edited && props.onRestore && (
          <button className="btn py-0.5 text-xs" onClick={props.onRestore} title="Back to the drawing's own words and place">
            Reset
          </button>
        )}
        {props.onToggle && (
          <button className="btn py-0.5 text-xs" onClick={props.onToggle}>
            {props.hidden ? "Show" : "Hide"}
          </button>
        )}
        {props.onDelete && (
          <button className="btn py-0.5 text-xs" onClick={props.onDelete}>
            Delete
          </button>
        )}
      </div>
      {props.multiline ? (
        <textarea ref={field} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onText(e.target.value)} rows={Math.max(1, props.value.split("\n").length)} className={`${cls} resize-none`} />
      ) : (
        <input ref={field} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onText(e.target.value)} className={`${cls} tabular-nums`} />
      )}
    </div>
  );
}

// The menu a click on a hole opens, beside it.
function HoleMenu({ hole, x, y, onPick, onClose }: { hole: Hole; x: number; y: number; onPick: (p: "dia" | "fit" | "note" | (typeof SCREWS)[number]) => void; onClose: () => void }) {
  const item = "press block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-white/10 pointer-coarse:py-2.5";
  return (
    <div
      role="menu"
      className="absolute z-10 w-48 rounded-lg border border-white/15 bg-[#0D111A] p-1 text-white shadow-xl"
      style={{ left: Math.min(x + 8, window.innerWidth - 210), top: Math.min(y + 8, window.innerHeight - 260) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-1 text-xs text-white/50">
        <span className="tabular-nums">Hole Ø{fmt(hole.d)}</span>
        <button className="press text-white/60 hover:text-white" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <button role="menuitem" className={item} onClick={() => onPick("dia")}>
        Ø dimension
      </button>
      {SCREWS.map((s) => (
        <button key={s} role="menuitem" className={item} onClick={() => onPick(s)}>
          {s} tapped
        </button>
      ))}
      <button role="menuitem" className={item} onClick={() => onPick("fit")}>
        Fit…
      </button>
      <button role="menuitem" className={item} onClick={() => onPick("note")}>
        Note…
      </button>
    </div>
  );
}

// A new note: a fit (to a part of the system or an inventory item, picked with thumbnails), a
// tapped screw, or nothing, plus any words typed after it.
function NoteForm({ draft, parts, onHole, onChange, onPlace, onCancel, disabled }: { draft: Draft; parts: FitPart[]; onHole: boolean; onChange: (d: Draft) => void; onPlace: () => void; onCancel: () => void; disabled: boolean }) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const tab = (on: boolean) => (on ? "btn-primary py-0.5 text-xs" : "btn py-0.5 text-xs");
  const preview = draftText(draft);
  return (
    <div className="space-y-2 rounded-md border border-sky-400/40 p-2">
      <div className="flex items-center font-semibold">
        <span className="flex-1">Add a note</span>
        <button className="press text-white/60 hover:text-white" onClick={onCancel} aria-label="Cancel">
          ✕
        </button>
      </div>
      <div className="flex gap-1.5">
        {(
          [
            ["fit", "Fit"],
            ["screw", "Tapped screw"],
            ["none", "Text only"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={tab(draft.kind === k)} onClick={() => set({ kind: k })}>
            {label}
          </button>
        ))}
      </div>
      {draft.kind === "fit" && (
        <>
          <select value={draft.fit} onChange={(e) => set({ fit: e.target.value as Fit })} className="input w-full text-sm" aria-label="Fit">
            {FITS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <FitPicker parts={parts} value={draft.target} onPick={(target) => set({ target })} />
        </>
      )}
      {draft.kind === "screw" && (
        <select value={draft.screw} onChange={(e) => set({ screw: e.target.value })} className="input w-full text-sm" aria-label="Screw">
          {SCREWS.map((s) => (
            <option key={s} value={s}>
              {s} tapped
            </option>
          ))}
        </select>
      )}
      <textarea value={draft.extra} onChange={(e) => set({ extra: e.target.value })} rows={2} className="input w-full text-sm" placeholder={draft.kind === "none" ? "Note" : "More text (optional)"} />
      {preview && <pre className="whitespace-pre-wrap rounded-md bg-white/5 p-2 font-sans text-xs text-white/80">{preview}</pre>}
      <button className="btn-primary w-full py-1 text-xs" disabled={disabled} onClick={onPlace}>
        {onHole ? "Place it on the hole" : "Place on the drawing"}
      </button>
      {!onHole && <p className="text-xs text-white/50">Then click where the arrow points (or a hole), then where the text goes.</p>}
    </div>
  );
}
