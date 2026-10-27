"use client";

import type { CardPart } from "./types";

// The status Release gives the selected parts.
export const RELEASED_STATUS = "Released";

// An in-house part To Fab can't place: no machine (it has no machine tab) or no material.
export const missingFabSetup = (p: CardPart) =>
  p.classification !== "cots" && (!p.material || (!p.preProcess && !p.process1 && !p.process2));

// Release on a system page: select parts, then Release marks them Released. Releasing parts To
// Fab can't place still works, with a warning above the buttons.
export function ReleaseBar({ count, selected, total, onRelease, onSelectAll, onDone }: { count: number; selected: CardPart[]; total: number; onRelease: () => void; onSelectAll: () => void; onDone: () => void }) {
  const unplaced = selected.filter(missingFabSetup).length;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line-strong bg-surface/95 p-3 backdrop-blur">
      {unplaced > 0 && (
        <p role="alert" className="mx-auto mb-2 flex max-w-5xl items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-500">
          <span aria-hidden className="font-bold">!</span>
          <span>
            <span className="font-mono tabular-nums">{unplaced}</span> selected in-house {unplaced === 1 ? "part has" : "parts have"} no machine or material set — they won&apos;t appear under a machine tab in To Fab.
          </span>
        </p>
      )}
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold tabular-nums">{count} selected</span>
        <button className="btn-primary" disabled={!count} onClick={onRelease}>
          Release
        </button>
        <button className="btn" onClick={onSelectAll}>
          Select all (<span className="font-mono tabular-nums">{total}</span>)
        </button>
        <button className="btn ml-auto" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
