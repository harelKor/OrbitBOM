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

type Hole = Drawing["holes"][number];
// Adding a note takes two clicks: where its arrow points, then where its text goes. Moving one
// moves its text or its arrow.
type Mode =
  | { kind: "idle" }
  | { kind: "arrow" }
  | { kind: "text"; leader?: Pt; hole?: Hole }
  | { kind: "moveText"; id: string }
  | { kind: "moveArrow"; id: string };

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
  moveText: "Click the text's new place",
  moveArrow: "Click where the arrow points now",
};

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
    } else if (mode.kind === "moveText") {
      if (added.some((a) => a.id === mode.id)) change({ ...edits, added: added.map((a) => (a.id === mode.id ? { ...a, at } : a)) });
      else change({ ...edits, moved: { ...edits.moved, [mode.id]: at } });
      setMode({ kind: "idle" });
    } else {
      const from = textCentre(mode.id);
      const leader = hole && from ? onEdge(hole, from) : at;
      if (added.some((a) => a.id === mode.id)) change({ ...edits, added: added.map((a) => (a.id === mode.id ? { ...a, leader } : a)) });
      else change({ ...edits, arrows: { ...edits.arrows, [mode.id]: leader } });
      setMode({ kind: "idle" });
    }
  }

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
  const hasArrow = (id: string) => !!drawing?.notes.find((n) => n.id === id)?.leader;

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
        <div className="min-h-0 flex-1 overflow-auto">
          {drawing ? (
            <div
              ref={sheet}
              onClick={onSheetClick}
              className={`mx-auto w-full max-w-[1100px] bg-white shadow-lg [&>svg]:block [&>svg]:h-auto [&>svg]:w-full ${mode.kind === "idle" ? "cursor-pointer" : "cursor-crosshair"}`}
              style={{ aspectRatio: `${drawing.sheet.w} / ${drawing.sheet.h}` }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            !error && <p className="text-sm text-white/60">Loading the drawing…</p>
          )}
        </div>

        <aside className="w-full shrink-0 space-y-3 overflow-auto rounded-lg border border-white/10 bg-[#0D111A] p-3 text-sm text-white lg:w-80">
          <NoteForm
            draft={draft}
            others={data?.others ?? []}
            onChange={setDraft}
            onPlace={() => setMode({ kind: "arrow" })}
            disabled={!drawing || !canAdd}
          />
          <div className="space-y-2">
            {base?.notes.map((n) => (
              <NoteRow
                key={n.id}
                text={edits.text?.[n.id] ?? n.text}
                hidden={hidden.has(n.id)}
                onText={(t) => change({ ...edits, text: { ...edits.text, [n.id]: t } })}
                onMoveText={() => setMode({ kind: "moveText", id: n.id })}
                onMoveArrow={hasArrow(n.id) ? () => setMode({ kind: "moveArrow", id: n.id }) : undefined}
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
                onMoveText={() => setMode({ kind: "moveText", id: a.id })}
                onMoveArrow={() => setMode({ kind: "moveArrow", id: a.id })}
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
  onMoveText: () => void;
  onMoveArrow?: () => void;
  onToggle?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className={`space-y-1 rounded-md border border-white/10 p-2 ${props.hidden ? "opacity-50" : ""}`}>
      <textarea value={props.text} onChange={(e) => props.onText(e.target.value)} rows={Math.max(1, props.text.split("\n").length)} className="input w-full resize-none text-sm" />
      <div className="flex flex-wrap gap-1.5 text-xs">
        <button className="btn py-0.5 text-xs" onClick={props.onMoveText} disabled={props.hidden}>
          Move text
        </button>
        {props.onMoveArrow && (
          <button className="btn py-0.5 text-xs" onClick={props.onMoveArrow} disabled={props.hidden}>
            Move arrow
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
