"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BEARINGS, DEFAULT_FIT, FITS, SCREWS, type Fit } from "@/config/drawings";
import type { DrawingEdits } from "@/db/schema";
import { downloadDrawing, fetchDrawing, type DrawingResponse } from "@/lib/drawing/download";
import { applyEdits, fmt, noteBox, partDrawing } from "@/lib/drawing/layout";
import { drawingSvg } from "@/lib/drawing/svg";
import type { Drawing, Pt } from "@/lib/drawing/types";
import { Icon } from "@/components/ui/Icon";
import { ZoomStage } from "./ZoomStage";

type Hole = Drawing["holes"][number];
// Adding a note takes two clicks: where its arrow points, then where its text goes. Moving one
// is a drag, of its text or of its arrow tip.
type Mode = { kind: "idle" } | { kind: "arrow" } | { kind: "text"; leader?: Pt; hole?: Hole };
// A note being dragged: its text (the arrow tip stays put) or its arrow tip. `off` is where the
// text was grabbed, from its anchor.
type Drag = { id: string; part: "text" | "arrow"; off: Pt; pointer: number; moved: boolean };

type Draft = { kind: "fit" | "screw" | "none"; fit: Fit; to: "bearing" | "part"; bearing: string; part: string | null; screw: string; extra: string };
const NEW_DRAFT: Draft = { kind: "fit", fit: DEFAULT_FIT, to: "bearing", bearing: BEARINGS[0].name, part: null, screw: "M5", extra: "" };

// The note's words: the fit or the tapped screw, then whatever the member typed.
function draftText(d: Draft, hole?: Hole) {
  const target = d.to === "bearing" ? d.bearing : d.part;
  const head =
    d.kind === "fit" && target ? `${d.fit} fit for\n${target}${hole ? `\nØ${fmt(hole.d)}` : ""}` : d.kind === "screw" ? `${d.screw} tapped` : "";
  return [head, d.extra.trim()].filter(Boolean).join("\n");
}

// The point on a hole's edge facing `toward`, or the clicked point itself.
const onEdge = (hole: Hole, toward: Pt): Pt => {
  const [dx, dy] = [toward[0] - hole.at[0], toward[1] - hole.at[1]];
  const l = Math.hypot(dx, dy) || 1;
  return [hole.at[0] + (dx / l) * hole.r, hole.at[1] + (dy / l) * hole.r];
};

const HINTS: Record<Mode["kind"], string | null> = {
  idle: null,
  arrow: "Click where the arrow points (a hole, or anywhere)",
  text: "Click where the text goes",
};

// A note's text box on the sheet; the tool note is drawn bigger (svg.ts).
function textRect(n: Drawing["notes"][number]) {
  const { rect } = noteBox(n.text, n.at);
  if (n.kind !== "tool" || n.leader) return rect;
  const k = 5 / 3.5;
  return { x0: rect.x0, y0: n.at[1] - 5, x1: rect.x0 + (rect.x1 - rect.x0) * k, y1: rect.y1 };
}

// The drawing editor (plan/auto-drawings.md): deliberately small. Change, hide or move any note
// (text and arrow apart), and add notes: a fit, a tapped screw, or plain words. Nothing else.
export function DrawingEditor({ partId, onClose }: { partId: string; onClose: () => void }) {
  const [data, setData] = useState<DrawingResponse | null>(null);
  const [edits, setEdits] = useState<DrawingEdits>({});
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"regenerate" | "delete" | null>(null);
  const [loads, setLoads] = useState(0); // bumped by Regenerate to fetch the new drawing
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [active, setActive] = useState<{ id: string; part: Drag["part"] } | null>(null); // under the mouse, or being dragged
  const [dragging, setDragging] = useState(false);
  const frame = useRef<HTMLDialogElement>(null);
  useEffect(() => frame.current?.showModal(), []);
  const router = useRouter();

  useEffect(() => {
    fetchDrawing(partId)
      .then((r) => {
        setData(r);
        setEdits(r.edits ?? {});
        setDirty(false);
      })
      .catch((e: Error) => setError(e.message));
  }, [partId, loads]);

  const base = useMemo(() => (data ? partDrawing(data.part, data.title) : null), [data]);
  const drawing = useMemo(() => (base ? applyEdits(base, edits) : null), [base, edits]);
  const svg = useMemo(() => (drawing ? drawingSvg(drawing) : ""), [drawing]);

  const change = (next: DrawingEdits) => {
    setEdits(next);
    setDirty(true);
  };
  const added = edits.added ?? [];
  const hidden = new Set(edits.hidden ?? []);
  const canAdd = !!draftText(draft).trim();

  function sheetPoint(e: React.MouseEvent): Pt | null {
    const box = sheet.current?.getBoundingClientRect();
    if (!box || !drawing) return null;
    return [((e.clientX - box.left) / box.width) * drawing.sheet.w, ((e.clientY - box.top) / box.height) * drawing.sheet.h];
  }
  const holeAt = (p: Pt) => drawing?.holes.find((h) => Math.hypot(h.at[0] - p[0], h.at[1] - p[1]) <= h.r + 3);
  // Where a note's text is, to aim an arrow from it.
  const textCentre = (id: string): Pt | undefined => {
    const n = drawing?.notes.find((x) => x.id === id);
    if (!n) return undefined;
    const { rect } = noteBox(n.text, n.at);
    return [(rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2];
  };

  function onSheetClick(e: React.MouseEvent) {
    if (swallow.current) {
      swallow.current = false;
      return;
    }
    if (mode.kind === "idle" && sheetPoint(e) && noteAt(sheetPoint(e)!)) return; // a press on a note
    const at = sheetPoint(e);
    if (!at || !drawing) return;
    const hole = holeAt(at);
    if (mode.kind === "idle") {
      // A click on a hole starts a note pointing at it.
      if (hole && canAdd) setMode({ kind: "text", hole });
    } else if (mode.kind === "arrow") {
      setMode(hole ? { kind: "text", hole } : { kind: "text", leader: at });
    } else if (mode.kind === "text") {
      const text = draftText(draft, mode.hole);
      const leader = mode.hole ? onEdge(mode.hole, at) : mode.leader;
      change({ ...edits, added: [...added, { id: `note:${Date.now()}`, text, at, ...(leader ? { leader } : {}) }] });
      setDraft({ ...draft, extra: "" });
      setMode({ kind: "idle" });
    }
  }

  const moveText = (id: string, at: Pt) =>
    added.some((a) => a.id === id) ? change({ ...edits, added: added.map((a) => (a.id === id ? { ...a, at } : a)) }) : change({ ...edits, moved: { ...edits.moved, [id]: at } });
  const moveArrow = (id: string, leader: Pt) =>
    added.some((a) => a.id === id)
      ? change({ ...edits, added: added.map((a) => (a.id === id ? { ...a, leader } : a)) })
      : change({ ...edits, arrows: { ...edits.arrows, [id]: leader } });

  // The note part under a sheet point: an arrow tip first (small, and often inside a text's
  // reach), then a text box.
  function noteAt(p: Pt): { id: string; part: Drag["part"] } | null {
    if (!drawing) return null;
    const tip = drawing.notes.find((n) => n.leader && Math.hypot(n.leader[0] - p[0], n.leader[1] - p[1]) <= 2.5);
    if (tip) return { id: tip.id, part: "arrow" };
    const pad = 1;
    const box = [...drawing.notes].reverse().find((n) => {
      const r = textRect(n);
      return p[0] >= r.x0 - pad && p[0] <= r.x1 + pad && p[1] >= r.y0 - pad && p[1] <= r.y1 + pad;
    });
    return box ? { id: box.id, part: "text" } : null;
  }

  // Press on a note's text or arrow tip and drag it, like a pin on the workshop map. While the
  // text moves its arrow keeps pointing at the same spot; a dragged tip snaps onto a hole's edge.
  function onSheetPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || mode.kind !== "idle" || !drawing) return;
    const p = sheetPoint(e);
    const hit = p && noteAt(p);
    if (!p || !hit) return;
    const n = drawing.notes.find((x) => x.id === hit.id)!;
    e.stopPropagation(); // no pan
    e.preventDefault();
    sheet.current?.setPointerCapture(e.pointerId);
    drag.current = { ...hit, off: hit.part === "text" ? [p[0] - n.at[0], p[1] - n.at[1]] : [0, 0], pointer: e.pointerId, moved: false };
    setActive(hit);
  }
  function onSheetPointerMove(e: React.PointerEvent) {
    const p = sheetPoint(e);
    if (!p) return;
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) {
      if (mode.kind === "idle" && !e.buttons) {
        const hit = noteAt(p);
        if (hit?.id !== active?.id || hit?.part !== active?.part) setActive(hit);
      }
      return;
    }
    if (!d.moved) {
      d.moved = true;
      setDragging(true);
    }
    if (d.part === "text") return moveText(d.id, [p[0] - d.off[0], p[1] - d.off[1]]);
    const hole = holeAt(p);
    const from = textCentre(d.id);
    moveArrow(d.id, hole && from ? onEdge(hole, from) : p);
  }
  function onSheetPointerUp(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    // A press without a move is still a click (it doesn't start a note on a hole under the text).
    if (d.moved) swallow.current = true;
  }
  const swallow = useRef(false);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/parts/${partId}/drawing`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(edits) });
    setSaving(false);
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn't save.");
    else setDirty(false);
  }

  // Make the drawing again from Onshape. Saved edits are kept; unsaved ones are lost.
  async function regenerate() {
    if (dirty && !confirm("Regenerate without saving your changes?")) return;
    setBusy("regenerate");
    setError(null);
    const res = await fetch(`/api/parts/${partId}/drawing`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ force: true }) });
    setBusy(null);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't regenerate the drawing.");
    setLoads((n) => n + 1);
    router.refresh();
  }

  async function remove() {
    if (!confirm("Delete this drawing and its notes?")) return;
    setBusy("delete");
    setError(null);
    const res = await fetch(`/api/parts/${partId}/drawing`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? "Couldn't delete the drawing.");
    router.refresh();
    onClose();
  }

  const close = () => {
    if (!dirty || confirm("Close without saving your changes?")) onClose();
  };
  const hint = HINTS[mode.kind];
  const activeNote = active && drawing?.notes.find((n) => n.id === active.id);

  // On document.body: inside the part card, pressing the sheet would scale the card (:active) and
  // pull the fixed editor into it. Clicks still bubble through React, so they stop here. A modal
  // <dialog>, so it opens above the part's details window it can be opened from.
  return createPortal(
    <dialog
      ref={frame}
      aria-label="Drawing editor"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="modal-enter m-0 h-dvh max-h-none w-screen max-w-none flex-col border-0 bg-[#07090E]/95 p-3 text-fg backdrop-blur open:flex sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-white">{data?.title.name ?? "Drawing"}</h2>
        {hint && (
          <span className="flex items-center gap-2 text-sm text-sky-300">
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
        <button className="btn" onClick={regenerate} disabled={!data || !!busy} title="Make it again from Onshape (keeps saved notes)">
          {busy === "regenerate" ? "Regenerating…" : "Regenerate"}
        </button>
        <button className="btn text-rose-600" onClick={remove} disabled={!data || !!busy}>
          {busy === "delete" ? "Deleting…" : "Delete"}
        </button>
        <button className="btn" onClick={() => downloadDrawing(partId, "pdf").catch((e: Error) => setError(e.message))} disabled={!drawing || dirty} title={dirty ? "Save first" : undefined}>
          PDF
        </button>
        <button className="btn-primary" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="press rounded-md p-2 text-white/70 hover:text-white" onClick={close} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      {error && <p className="mb-2 rounded-md bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
      {data?.outdated && <p className="mb-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">The part changed in Onshape since this drawing was made. Regenerate it to update.</p>}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {drawing ? (
          // The whole sheet fits without scrollbars; Ctrl + wheel zooms, drag pans when zoomed in.
          <ZoomStage aspect={drawing.sheet.w / drawing.sheet.h} leftPan={mode.kind === "idle"} className="min-h-[55dvh] flex-1 rounded-lg lg:h-[calc(100dvh-7rem)] lg:min-h-0">
            <div
              ref={sheet}
              onClick={onSheetClick}
              onPointerDown={onSheetPointerDown}
              onPointerMove={onSheetPointerMove}
              onPointerUp={onSheetPointerUp}
              onPointerCancel={onSheetPointerUp}
              onPointerLeave={() => !drag.current && setActive(null)}
              className={`relative h-full w-full touch-none select-none bg-white shadow-lg ${
                dragging ? "cursor-grabbing" : active ? "cursor-grab" : mode.kind === "idle" ? "cursor-pointer" : "cursor-crosshair"
              }`}
            >
              <div className="h-full w-full [&>svg]:block [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
              {/* Arrow tip handles, and the note under the mouse outlined. */}
              <svg viewBox={`0 0 ${drawing.sheet.w} ${drawing.sheet.h}`} className="pointer-events-none absolute inset-0 h-full w-full">
                {mode.kind === "idle" &&
                  drawing.notes.map(
                    (n) =>
                      n.leader && (
                        <circle
                          key={n.id}
                          cx={n.leader[0]}
                          cy={n.leader[1]}
                          r={active?.id === n.id && active.part === "arrow" ? 1.6 : 1.1}
                          fill={active?.id === n.id && active.part === "arrow" ? "#0EA5E9" : "rgba(14,165,233,0.25)"}
                          stroke="#0EA5E9"
                          strokeWidth={0.25}
                        />
                      ),
                  )}
                {activeNote && active?.part === "text" && (() => {
                  const r = textRect(activeNote);
                  return <rect x={r.x0 - 1} y={r.y0 - 1} width={r.x1 - r.x0 + 2} height={r.y1 - r.y0 + 2} rx={0.8} fill="rgba(56,189,248,0.10)" stroke="#38BDF8" strokeWidth={0.3} />;
                })()}
              </svg>
            </div>
          </ZoomStage>
        ) : (
          <div className="min-h-0 flex-1">{!error && <p className="text-sm text-white/60">Loading the drawing…</p>}</div>
        )}

        <aside className="w-full shrink-0 space-y-3 overflow-auto rounded-lg border border-white/10 bg-[#0D111A] p-3 text-sm text-white lg:w-80">
          <NoteForm
            draft={draft}
            others={data?.others ?? []}
            onChange={setDraft}
            onPlace={() => setMode({ kind: "arrow" })}
            disabled={!drawing || !canAdd}
          />
          <p className="text-xs text-white/50">Drag a note&apos;s text or its arrow tip on the drawing to move it. Ctrl + wheel zooms; drag, Space + drag or the middle button pans.</p>
          <div className="space-y-2">
            {base?.notes.map((n) => (
              <NoteRow
                key={n.id}
                text={edits.text?.[n.id] ?? n.text}
                hidden={hidden.has(n.id)}
                onText={(t) => change({ ...edits, text: { ...edits.text, [n.id]: t } })}
                onToggle={() =>
                  change({ ...edits, hidden: hidden.has(n.id) ? [...hidden].filter((x) => x !== n.id) : [...hidden, n.id] })
                }
              />
            ))}
            {added.map((a) => (
              <NoteRow
                key={a.id}
                text={a.text}
                onText={(t) => change({ ...edits, added: added.map((x) => (x.id === a.id ? { ...x, text: t } : x)) })}
                onDelete={() => change({ ...edits, added: added.filter((x) => x.id !== a.id) })}
              />
            ))}
          </div>
        </aside>
      </div>
    </dialog>,
    document.body,
  );
}

function NoteRow(props: {
  text: string;
  hidden?: boolean;
  onText: (t: string) => void;
  onToggle?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className={`space-y-1 rounded-md border border-white/10 p-2 ${props.hidden ? "opacity-50" : ""}`}>
      <textarea value={props.text} onChange={(e) => props.onText(e.target.value)} rows={Math.max(1, props.text.split("\n").length)} className="input w-full resize-none text-sm" />
      <div className="flex flex-wrap gap-1.5 text-xs">
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
    </div>
  );
}

// A new note: a fit (to a stored bearing or another part of the system), a tapped screw, or
// nothing, plus any words typed after it.
function NoteForm({ draft, others, onChange, onPlace, disabled }: { draft: Draft; others: string[]; onChange: (d: Draft) => void; onPlace: () => void; disabled: boolean }) {
  const [search, setSearch] = useState("");
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const found = others.filter((o) => o.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 30);
  const tab = (on: boolean) => (on ? "btn-primary py-0.5 text-xs" : "btn py-0.5 text-xs");
  const preview = draftText(draft);
  return (
    <div className="space-y-2 rounded-md border border-white/10 p-2">
      <div className="font-semibold">Add a note</div>
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
          <div className="flex gap-1.5">
            <button className={tab(draft.to === "bearing")} onClick={() => set({ to: "bearing" })}>
              Bearing
            </button>
            <button className={tab(draft.to === "part")} onClick={() => set({ to: "part" })}>
              Part
            </button>
          </div>
          {draft.to === "bearing" ? (
            <select value={draft.bearing} onChange={(e) => set({ bearing: e.target.value })} className="input w-full text-sm" aria-label="Bearing">
              {BEARINGS.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name} (Ø{fmt(b.boreMm)})
                </option>
              ))}
            </select>
          ) : (
            <div className="space-y-1">
              <input value={search} onChange={(e) => setSearch(e.target.value)} className="input w-full text-sm" placeholder="Search parts" aria-label="Search parts" />
              <div className="max-h-40 overflow-auto rounded-md border border-white/10">
                {found.length ? (
                  found.map((o) => (
                    <button key={o} onClick={() => set({ part: o })} className={`block w-full truncate px-2 py-1 text-left text-xs hover:bg-white/10 ${draft.part === o ? "bg-sky-500/30" : ""}`}>
                      {o}
                    </button>
                  ))
                ) : (
                  <p className="px-2 py-1 text-xs text-white/50">No parts match.</p>
                )}
              </div>
            </div>
          )}
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
        Place on the drawing
      </button>
      <p className="text-xs text-white/50">Then click where the arrow points (or a hole), then where the text goes.</p>
    </div>
  );
}
