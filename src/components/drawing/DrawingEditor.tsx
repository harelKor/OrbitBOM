"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_FIT, FITS, SCREWS, type Fit } from "@/config/drawings";
import type { DrawingEdits, DrawingRef } from "@/db/schema";
import { downloadDrawing, fetchDrawing, type DrawingResponse, type FitPart } from "@/lib/drawing/download";
import { applyEdits, dimFrame, dimHit, dimLine, dimOff, dimRect, fmt, linkNotes, measure, noteBox, partDrawing, sheetToRef } from "@/lib/drawing/layout";
import { dimension, drawingSvg, note as noteSvg } from "@/lib/drawing/svg";
import type { Dim, DimDir, Drawing, Note, Pt } from "@/lib/drawing/types";
import { Icon } from "@/components/ui/Icon";
import { ZoomStage } from "./ZoomStage";
import { FitPicker, linkTargets, useFitItems, useOpenFitLink, type FitTarget } from "./fit";
import { Notice } from "@/components/ui/Notice";
import { askConfirm } from "@/components/ui/useConfirm";

type Hole = Drawing["holes"][number];
type Snap = { at: Pt; view: string };
type Edge = Drawing["edges"][number];
type Item = { id: string; type: "note" | "dim" };
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
type Drag = { item: Item; part: "text" | "arrow" | "line"; off: Pt; pointer: number; moved: boolean; before: DrawingEdits };

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

// The drawing editor (plan/auto-drawings.md): small on purpose. Every automatic note and
// dimension can be retyped, hidden or moved; members add notes (a fit, a tapped screw, plain
// words) and dimensions (Onshape-style: points or an edge, or a hole's Ø). Nothing else.
// `load` / `store` stand in for the part's drawing route on /dev/drawing (no Onshape locally).
export function DrawingEditor({
  partId,
  onClose,
  load = fetchDrawing,
  store,
}: {
  partId: string;
  onClose: () => void;
  load?: (partId: string) => Promise<DrawingResponse>;
  store?: (edits: DrawingEdits) => Promise<void>;
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
  const [hover, setHover] = useState<(Item & { part: Drag["part"] }) | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [holeMenu, setHoleMenu] = useState<{ hole: Hole; x: number; y: number } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null); // a double-clicked item: focus its field
  useEffect(() => frame.current?.showModal(), []);
  const router = useRouter();

  const { reset } = h;
  useEffect(() => {
    load(partId)
      .then((r) => {
        setData(r);
        reset(r.edits ?? {});
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset is stable enough; refetch only on part / Regenerate
  }, [partId, loads]);

  const items = useFitItems();
  const openFitLink = useOpenFitLink();
  const base = useMemo(() => (data ? partDrawing(data.part, data.title) : null), [data]);
  const drawing = useMemo(() => (base ? applyEdits(base, edits) : null), [base, edits]);
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
  function itemAt(p: Pt): (Item & { part: Drag["part"] }) | null {
    if (!drawing) return null;
    const tip = drawing.notes.find((n) => n.leader && dist(n.leader, p) <= 2.5);
    if (tip) return { id: tip.id, type: "note", part: "arrow" };
    const box = [...drawing.notes].reverse().find((n) => inside(p, textRect(n)));
    if (box) return { id: box.id, type: "note", part: "text" };
    const dim = [...drawing.dims].reverse().find((d) => dimHit(d, p));
    return dim ? { id: dim.id, type: "dim", part: "line" } : null;
  }

  const isAddedNote = (id: string) => added.some((a) => a.id === id);
  const isAddedDim = (id: string) => addedDims.some((a) => a.id === id);

  // Place a new note: its arrow tip is kept against the part (and its hole), its text beside it.
  function addNote(text: string, at: Pt, leader: Pt | undefined, hole: Hole | undefined, extra: Partial<NonNullable<DrawingEdits["added"]>[number]> = {}) {
    if (!drawing) return;
    const ref = leader ? sheetToRef(drawing, leader, hole ? { hole: hole.id } : {}) : null;
    const id = `note:${Date.now()}`;
    change({
      ...edits,
      added: [...added, { id, text, at, ...(leader ? { leader } : {}), ...(ref ? { ref, off: minus(at, leader!) } : {}), ...extra }],
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
      if (hit) {
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
        const dir: DimDir | undefined = axisAligned(pair[0], pair[1]) ? undefined : "a";
        return setMode({ kind: "dimPlace", a: { at: pair[0], view }, b: { at: pair[1], view }, ...(dir ? { dir } : {}) });
      }
      // Nothing to measure to: the edge's own length, placed here.
      return createDim({ at: e.a, view }, { at: e.b, view }, axisAligned(e.a, e.b) ? chooseDir(e.a, e.b, at) : "a", at);
    }
    if (mode.kind === "dim2") {
      const snap = snapAt(at, mode.a.view);
      if (snap && dist(snap.at, mode.a.at) > 0.05) setMode({ kind: "dimPlace", a: mode.a, b: snap });
      return;
    }
    if (mode.kind === "dimPlace") createDim(mode.a, mode.b, mode.dir ?? chooseDir(mode.a.at, mode.b.at, at), at);
  }

  // Where a dimension's line goes for the pointer at p: y or x for horizontal / vertical, the
  // distance beside the a-b line for aligned (in dimFrame's own sense of beside).
  const lineAtFor = (a: Pt, b: Pt, dir: DimDir, p: Pt) => (dir === "h" ? p[1] : dir === "v" ? p[0] : dimFrame({ id: "", a, b, dir, at: 0, text: "" }).local(p)[1]);

  function createDim(a: Snap, b: Snap, dir: DimDir, p: Pt) {
    if (!drawing) return;
    const [ra, rb] = [sheetToRef(drawing, a.at, { view: a.view }), sheetToRef(drawing, b.at, { view: a.view })];
    if (!ra || !rb) return;
    const id = `dim:${Date.now()}`;
    const lineAt = lineAtFor(a.at, b.at, dir, p);
    const off = dir === "a" ? lineAt : dimOff(a.at, b.at, dir, lineAt);
    change({ ...edits, dims: [...addedDims, { id, a: ra, b: rb, dir, off }] });
    setSelected({ id, type: "dim" });
    setMode({ kind: "dim1" }); // keep dimensioning, as Onshape does, until Esc
  }

  // Dragging writes the move as a shift from where the drawing put the item, or for added items
  // against the part, so it survives the drawing being made again.
  function moveTo(d: Drag, p: Pt) {
    if (!base || !drawing) return;
    const id = d.item.id;
    const opts = { record: false };
    if (d.item.type === "dim") {
      const shown = drawing.dims.find((x) => x.id === id);
      if (!shown) return;
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
    if (d.part === "text") {
      const at: Pt = [p[0] - d.off[0], p[1] - d.off[1]];
      const a = added.find((x) => x.id === id);
      if (a) return change({ ...edits, added: added.map((x) => (x.id === id ? { ...x, at, ...(x.ref && x.leader ? { off: minus(at, drawing.notes.find((n) => n.id === id)?.leader ?? x.leader) } : {}) } : x)) }, opts);
      const auto = base.notes.find((x) => x.id === id);
      if (!auto) return;
      return change({ ...edits, moved: without(edits.moved, id), shift: { ...edits.shift, [id]: minus(at, auto.at) } }, opts);
    }
    // The arrow tip, snapped onto a hole's edge when over one.
    const hole = holeAt(p);
    const from = textCentre(id);
    const tip = hole && from ? onEdge(hole, from) : p;
    const ref: DrawingRef | null = sheetToRef(drawing, tip, hole ? { hole: hole.id } : {});
    const a = added.find((x) => x.id === id);
    if (a) {
      const at = drawing.notes.find((n) => n.id === id)?.at ?? a.at;
      return change({ ...edits, added: added.map((x) => (x.id === id ? { ...x, leader: tip, at, ...(ref ? { ref, off: minus(at, tip) } : { ref: undefined, off: undefined }) } : x)) }, opts);
    }
    const arrows = without(edits.arrows, id);
    if (ref) change({ ...edits, arrows, tips: { ...edits.tips, [id]: ref } }, opts);
    else change({ ...edits, arrows: { ...edits.arrows, [id]: tip } }, opts);
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
    if (hit.part === "text") off = minus(p, drawing.notes.find((x) => x.id === hit.id)!.at);
    if (hit.part === "line") {
      // Where it was grabbed, in the dimension's own frame: along from its text, across from its line.
      const f = dimFrame(drawing.dims.find((x) => x.id === hit.id)!);
      const [along, across] = f.local(p);
      off = [along - f.tc, across - f.at];
    }
    drag.current = { item: { id: hit.id, type: hit.type }, part: hit.part, off, pointer: e.pointerId, moved: false, before: edits };
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
        if (hit?.id !== hover?.id || hit?.part !== hover?.part) setHover(hit);
      }
      return;
    }
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
      setSelected(d.item);
      change(edits, { from: d.before }); // one undo step for the whole drag
    }
    moveTo(d, p);
  }
  function onSheetPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (d.moved) swallow.current = true;
  }

  // Hide an automatic item, delete an added one.
  const remove = (it: Item) => {
    if (it.type === "dim" && isAddedDim(it.id)) change({ ...edits, dims: addedDims.filter((x) => x.id !== it.id) });
    else if (it.type === "note" && isAddedNote(it.id)) change({ ...edits, added: added.filter((x) => x.id !== it.id) });
    else change({ ...edits, hidden: [...new Set([...(edits.hidden ?? []), it.id])] });
    setSelected(null);
  };
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
    if (typing) return;
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
        ? { a: { at: mode.edge.a, view: mode.edge.view }, b: { at: mode.edge.b, view: mode.edge.view }, dir: axisAligned(mode.edge.a, mode.edge.b) ? undefined : ("a" as const) }
        : null;
    const placing = mode.kind === "dimPlace" ? mode : fromEdge;
    if (placing) {
      const dir = placing.dir ?? chooseDir(placing.a.at, placing.b.at, pointer);
      const text = fmt(measure(drawing, placing.a.view, placing.a.at, placing.b.at, dir));
      return dimension({ id: "preview", a: placing.a.at, b: placing.b.at, dir, at: lineAtFor(placing.a.at, placing.b.at, dir, pointer), text });
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

  const cursor = dragging ? "cursor-grabbing" : busyMode ? "cursor-crosshair" : hover ? "cursor-grab" : "cursor-default";

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
            Click a hole to note it. Drag any note, arrow tip or dimension to move it; double-click to retype it. The wheel or a pinch zooms; drag empty paper to pan.
          </p>
          {base && drawing && (
            <>
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
