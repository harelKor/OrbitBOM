"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BEARINGS, DEFAULT_FIT, FITS, type Fit } from "@/config/drawings";
import type { DrawingEdits } from "@/db/schema";
import { downloadDrawing, fetchDrawing, type DrawingResponse } from "@/lib/drawing/download";
import { applyEdits, fmt, freeSpot, partDrawing } from "@/lib/drawing/layout";
import { drawingSvg } from "@/lib/drawing/svg";
import type { Drawing, Pt } from "@/lib/drawing/types";
import { Icon } from "@/components/ui/Icon";

type Hole = Drawing["holes"][number];
type Mode = { kind: "idle" } | { kind: "place" } | { kind: "move"; id: string };

// The drawing editor (plan/auto-drawings.md): deliberately small. Change, hide or move any note,
// click a hole to add a fit or a note to it, or click anywhere to add a free note. Nothing else.
export function DrawingEditor({ partId, onClose }: { partId: string; onClose: () => void }) {
  const [data, setData] = useState<DrawingResponse | null>(null);
  const [edits, setEdits] = useState<DrawingEdits>({});
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [hole, setHole] = useState<Hole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchDrawing(partId)
      .then((r) => {
        setData(r);
        setEdits(r.edits ?? {});
      })
      .catch((e: Error) => setError(e.message));
  }, [partId]);

  const base = useMemo(() => (data ? partDrawing(data.part, data.title) : null), [data]);
  const drawing = useMemo(() => (base ? applyEdits(base, edits) : null), [base, edits]);
  const svg = useMemo(() => (drawing ? drawingSvg(drawing) : ""), [drawing]);

  const change = (next: DrawingEdits) => {
    setEdits(next);
    setDirty(true);
  };
  const added = edits.added ?? [];
  const hidden = new Set(edits.hidden ?? []);

  function sheetPoint(e: React.MouseEvent): Pt | null {
    const box = sheet.current?.getBoundingClientRect();
    if (!box || !drawing) return null;
    return [((e.clientX - box.left) / box.width) * drawing.sheet.w, ((e.clientY - box.top) / box.height) * drawing.sheet.h];
  }

  function onSheetClick(e: React.MouseEvent) {
    const at = sheetPoint(e);
    if (!at || !drawing) return;
    if (mode.kind === "place") {
      change({ ...edits, added: [...added, { id: `note:${Date.now()}`, text: "Note", at }] });
      setMode({ kind: "idle" });
    } else if (mode.kind === "move") {
      if (added.some((a) => a.id === mode.id)) change({ ...edits, added: added.map((a) => (a.id === mode.id ? { ...a, at } : a)) });
      else change({ ...edits, moved: { ...edits.moved, [mode.id]: at } });
      setMode({ kind: "idle" });
    } else {
      const hit = drawing.holes.find((h) => Math.hypot(h.at[0] - at[0], h.at[1] - at[1]) <= h.r + 3);
      setHole(hit ?? null);
    }
  }

  function addHoleNote(h: Hole, text: string) {
    const { at, leader } = freeSpot(drawing!, h.at, h.r, text);
    change({ ...edits, added: [...added, { id: `hole:${h.id}:${Date.now()}`, text, at, leader }] });
    setHole(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/parts/${partId}/drawing`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(edits) });
    setSaving(false);
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Couldn't save.");
    else setDirty(false);
  }

  const close = () => {
    if (!dirty || confirm("Close without saving your changes?")) onClose();
  };

  // On document.body: inside the part card, pressing the sheet would scale the card (:active) and
  // pull the fixed editor into it. Clicks still bubble through React, so they stop here.
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-[#07090E]/95 p-3 backdrop-blur sm:p-5" role="dialog" aria-label="Drawing editor" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-white">{data?.title.name ?? "Drawing"}</h2>
        {mode.kind !== "idle" && <span className="text-sm text-sky-300">{mode.kind === "place" ? "Click where the note goes" : "Click the note's new place"}</span>}
        <button className="btn" onClick={() => setMode(mode.kind === "place" ? { kind: "idle" } : { kind: "place" })} disabled={!drawing}>
          Add note
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
      {data?.outdated && <p className="mb-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">The part changed in Onshape since this drawing was made. Make it again from the system page.</p>}

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
          {hole ? (
            <HoleForm key={hole.id} hole={hole} others={data?.others ?? []} onAdd={(t) => addHoleNote(hole, t)} onCancel={() => setHole(null)} />
          ) : (
            <p className="text-xs text-white/50">Click a hole to add a fit or a note to it.</p>
          )}
          <div className="space-y-2">
            {base?.notes.map((n) => (
              <NoteRow
                key={n.id}
                text={edits.text?.[n.id] ?? n.text}
                hidden={hidden.has(n.id)}
                onText={(t) => change({ ...edits, text: { ...edits.text, [n.id]: t } })}
                onMove={() => setMode({ kind: "move", id: n.id })}
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
                onMove={() => setMode({ kind: "move", id: a.id })}
                onDelete={() => change({ ...edits, added: added.filter((x) => x.id !== a.id) })}
              />
            ))}
          </div>
        </aside>
      </div>
    </div>,
    document.body,
  );
}

function NoteRow(props: { text: string; hidden?: boolean; onText: (t: string) => void; onMove: () => void; onToggle?: () => void; onDelete?: () => void }) {
  return (
    <div className={`space-y-1 rounded-md border border-white/10 p-2 ${props.hidden ? "opacity-50" : ""}`}>
      <textarea value={props.text} onChange={(e) => props.onText(e.target.value)} rows={Math.max(1, props.text.split("\n").length)} className="input w-full resize-none text-sm" />
      <div className="flex gap-1.5 text-xs">
        <button className="btn py-0.5 text-xs" onClick={props.onMove} disabled={props.hidden}>
          Move
        </button>
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

// A fit (to a stored bearing or another part of the system) or a plain note.
function HoleForm({ hole, others, onAdd, onCancel }: { hole: Hole; others: string[]; onAdd: (text: string) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<"fit" | "note">("fit");
  const [fit, setFit] = useState<Fit>(DEFAULT_FIT);
  const [to, setTo] = useState<"bearing" | "part">("bearing");
  const [bearing, setBearing] = useState(BEARINGS[0].name);
  const [search, setSearch] = useState("");
  const [part, setPart] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const target = to === "bearing" ? bearing : part;
  const text = kind === "fit" ? (target ? `${fit} fit for\n${target}\nØ${fmt(hole.d)}` : "") : note;
  const found = others.filter((o) => o.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 30);
  const tab = (on: boolean) => (on ? "btn-primary py-0.5 text-xs" : "btn py-0.5 text-xs");
  return (
    <div className="space-y-2">
      <div className="font-semibold tabular-nums">Hole Ø{fmt(hole.d)}</div>
      <div className="flex gap-1.5">
        {(["fit", "note"] as const).map((k) => (
          <button key={k} className={tab(kind === k)} onClick={() => setKind(k)}>
            {k === "fit" ? "Fit" : "Note"}
          </button>
        ))}
      </div>
      {kind === "fit" ? (
        <>
          <label className="block text-xs text-white/60">
            Fit
            <select value={fit} onChange={(e) => setFit(e.target.value as Fit)} className="input mt-1 w-full text-sm">
              {FITS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <div className="flex gap-1.5">
            <button className={tab(to === "bearing")} onClick={() => setTo("bearing")}>
              Bearing
            </button>
            <button className={tab(to === "part")} onClick={() => setTo("part")}>
              Part
            </button>
          </div>
          {to === "bearing" ? (
            <select value={bearing} onChange={(e) => setBearing(e.target.value)} className="input w-full text-sm" aria-label="Bearing">
              {BEARINGS.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name} (Ø{fmt(b.boreMm)})
                </option>
              ))}
            </select>
          ) : (
            <div className="space-y-1">
              <input value={search} onChange={(e) => setSearch(e.target.value)} className="input w-full text-sm" placeholder="Search parts" aria-label="Search parts" />
              <div className="max-h-48 overflow-auto rounded-md border border-white/10">
                {found.length ? (
                  found.map((o) => (
                    <button key={o} onClick={() => setPart(o)} className={`block w-full truncate px-2 py-1 text-left text-xs hover:bg-white/10 ${part === o ? "bg-sky-500/30" : ""}`}>
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
      ) : (
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="input w-full text-sm" placeholder="Note" />
      )}
      {text && <pre className="whitespace-pre-wrap rounded-md bg-white/5 p-2 font-sans text-xs text-white/80">{text}</pre>}
      <div className="flex gap-1.5">
        <button className="btn-primary py-0.5 text-xs" disabled={!text.trim()} onClick={() => onAdd(text)}>
          Add
        </button>
        <button className="btn py-0.5 text-xs" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
