"use client";

import { CALL_COSTS, costHint, makeDrawingsCost } from "@/config/callCosts";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { syncOnshapeDrawings } from "@/components/drawing/syncOnshape";
import type { MakeSummary } from "@/lib/drawing/make";
import { partTitle, type CardPart } from "./types";

// System page, Edit mode → Drawings: pick parts (or Select all) and make their fabrication
// drawings from Onshape. Plates, square tubes, hex shafts and round tubes get one; the rest are
// listed as skipped. Calls again while the server says some are left. Sync Onshape drawings pulls
// the drawing tabs named like a part (all the system's parts, or the picked ones) as its drawing
// file; only on that click, to keep Onshape calls down.
export function DrawingsBar({
  systemId,
  selected,
  outdated,
  total,
  onSelectAll,
  onDone,
}: {
  systemId: string;
  selected: CardPart[];
  outdated: CardPart[]; // parts whose drawing is older than the part in Onshape
  total: number;
  onSelectAll: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<false | "make" | "sync">(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A merged row stands for its members; each gets its own drawing.
  const idsOf = (list: CardPart[]) => [...new Set(list.flatMap((p) => p.memberIds ?? [p.id]))];
  const ids = idsOf(selected);

  async function sync() {
    setBusy("sync");
    setError(null);
    setResult(null);
    try {
      const r = await syncOnshapeDrawings(systemId, ids.length ? ids : undefined);
      setResult(
        r.found === 0
          ? "No drawing tabs found in this system's Onshape document."
          : `${r.linked.length} Onshape drawing${r.linked.length === 1 ? "" : "s"} linked` +
              (r.unchanged.length ? ` · ${r.unchanged.length} already up to date` : "") +
              (r.left.length ? ` · ${r.left.length} left, run it again` : "") +
              (r.linked.length + r.unchanged.length === 0 ? ` · none of the ${r.found} drawing tabs has a part's number or name` : ""),
      );
      if (r.linked.length) router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Only drawings older than their part are made again (make.ts skips current ones), edits kept.
  async function make(ids: string[], list: CardPart[]) {
    setBusy("make");
    setError(null);
    setResult(null);
    const made = new Set<string>();
    const skipped = new Map<string, string>();
    let left = ids;
    try {
      while (left.length) {
        const res = await fetch(`/api/systems/${systemId}/drawings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ partIds: left }),
        });
        const body = (await res.json()) as MakeSummary & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Couldn't make the drawings.");
        body.made.forEach((id) => made.add(id));
        body.skipped.forEach((s) => skipped.set(s.id, s.reason));
        if (body.left.length >= left.length) break; // no progress: stop rather than loop
        left = body.left;
      }
      const names = (id: string) => partTitle(list.find((p) => (p.memberIds ?? [p.id]).includes(id)) ?? { displayName: null, onshapeName: null });
      setResult(
        `${made.size} drawing${made.size === 1 ? "" : "s"} ready` +
          (skipped.size ? ` · skipped ${[...skipped].map(([id, why]) => `${names(id)} (${why})`).join(", ")}` : ""),
      );
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed bottom-0 left-[var(--shell-left)] right-[var(--shell-right)] z-40 border-t border-line-strong bg-surface/95 p-3 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold tabular-nums">{selected.length} selected</span>
        <button className="btn" onClick={onSelectAll} disabled={!!busy || selected.length === total}>
          Select all
        </button>
        <button className="btn-primary" onClick={() => make(ids, selected)} disabled={!!busy || ids.length === 0} {...costHint(makeDrawingsCost(ids.length))}>
          {busy === "make" ? "Making drawings…" : "Make drawings"}
        </button>
        {outdated.length > 0 && (
          <button
            className="btn"
            onClick={() => make(idsOf(outdated), outdated)}
            disabled={!!busy}
            {...costHint(makeDrawingsCost(idsOf(outdated).length))}
            title="Make again the drawings of parts changed in Onshape since; their notes and dimensions are kept"
          >
            Update out-of-date ({outdated.length})
          </button>
        )}
        <button
          className="btn"
          onClick={sync}
          disabled={!!busy}
          {...costHint(CALL_COSTS.fetchDrawings)}
          title={`Fetch the Onshape drawing tabs named like ${ids.length ? "the picked parts" : "this system's parts"} as their drawing files`}
        >
          {busy === "sync" ? "Syncing Onshape drawings…" : "Sync Onshape drawings"}
        </button>
        <button className="btn ml-auto" onClick={onDone} disabled={!!busy}>
          Done
        </button>
        {result && <span className="w-full text-fg-2">{result}</span>}
        {error && <span className="w-full text-rose-700">{error}</span>}
      </div>
    </div>
  );
}
