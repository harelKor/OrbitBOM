"use client";

import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Checkbox } from "@/components/ui/Checkbox";
import { COTS_LINK_REQUIRED } from "@/lib/parts/cotsLink";
import type { CardPart } from "./types";

// The status Release gives the selected parts.
export const RELEASED_STATUS = "Released";

// An in-house part To Fab can't place: no machine (it has no machine tab) or no material.
export const missingFabSetup = (p: CardPart) =>
  p.classification !== "cots" && (!p.material || (!p.preProcess && !p.process1 && !p.process2));

// A COTS part Release can't send to the COTS page: it has no inventory item yet.
export const unlinkedCots = (p: CardPart) => p.classification === "cots" && !p.inventoryItemId;

// What the releasing member confirms first, every box ticked (Harel, 2026-10-30).
const CHECKS = [
  "Were the parts reviewed by a mentor/CAD lead?",
  "Did you check them against the rest of the robot assembly?",
  "Did you check drill sizes and general fabricating constraints?",
];

function UnplacedWarning({ count }: { count: number }) {
  return (
    <p role="alert" className="flex items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-500">
      <span aria-hidden className="font-bold">!</span>
      <span>
        <span className="font-mono tabular-nums">{count}</span> selected in-house {count === 1 ? "part has" : "parts have"} no machine or material set — they won&apos;t appear under a machine tab in To Fab.
      </span>
    </p>
  );
}

function UnlinkedWarning({ count }: { count: number }) {
  return (
    <p role="alert" className="flex items-center gap-2 rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-500">
      <span aria-hidden className="font-bold">✕</span>
      <span>
        {COTS_LINK_REQUIRED} <span className="font-mono tabular-nums">{count}</span> selected COTS {count === 1 ? "part isn't" : "parts aren't"} linked and won&apos;t be released.
      </span>
    </p>
  );
}

// Release on a system page: select parts, then Release opens the checklist and Confirm Release
// marks them Released. Releasing parts To Fab can't place still works, with a warning; COTS parts
// with no inventory item are left out (onRelease gets the ids that may be released).
export function ReleaseBar({ count, selected, total, onRelease, onSelectAll, onDone }: { count: number; selected: CardPart[]; total: number; onRelease: (ids: string[]) => void; onSelectAll: () => void; onDone: () => void }) {
  const unplaced = selected.filter(missingFabSetup).length;
  const unlinked = selected.filter(unlinkedCots).length;
  const releasable = selected.filter((p) => !unlinkedCots(p));
  const releaseCount = releasable.length;
  const [confirming, setConfirming] = useState(false);
  const [ticked, setTicked] = useState<boolean[]>(() => CHECKS.map(() => false));
  const open = () => {
    setTicked(CHECKS.map(() => false));
    setConfirming(true);
  };
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line-strong bg-surface/95 p-3 backdrop-blur">
      {(unplaced > 0 || unlinked > 0) && (
        <div className="mx-auto mb-2 flex max-w-5xl flex-col gap-2">
          {unlinked > 0 && <UnlinkedWarning count={unlinked} />}
          {unplaced > 0 && <UnplacedWarning count={unplaced} />}
        </div>
      )}
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 text-sm">
        <span className="font-mono font-semibold tabular-nums">{count} selected</span>
        <button className="btn-primary active:scale-[0.98]" disabled={!releaseCount} onClick={open}>
          Release
        </button>
        <button className="btn active:scale-[0.98]" onClick={onSelectAll}>
          Select all (<span className="font-mono tabular-nums">{total}</span>)
        </button>
        <button className="btn ml-auto active:scale-[0.98]" onClick={onDone}>
          Cancel
        </button>
      </div>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={
          <>
            Release <span className="font-mono tabular-nums">{releaseCount}</span> {releaseCount === 1 ? "part" : "parts"}
          </>
        }
      >
        <div className="space-y-3">
          {unlinked > 0 && <UnlinkedWarning count={unlinked} />}
          {unplaced > 0 && <UnplacedWarning count={unplaced} />}
          <p className="text-sm text-muted">Tick every box before releasing.</p>
          <div className="flex flex-col gap-1">
            {CHECKS.map((text, i) => (
              <Checkbox key={text} checked={ticked[i]} onChange={(on) => setTicked((t) => t.map((v, j) => (j === i ? on : v)))}>
                <span>
                  <span className="font-mono tabular-nums">{i + 1}.</span> {text}
                </span>
              </Checkbox>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn active:scale-[0.98]" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary active:scale-[0.98]"
              disabled={!releaseCount || !ticked.every(Boolean)}
              onClick={() => {
                setConfirming(false);
                onRelease(releasable.map((p) => p.id));
              }}
            >
              Confirm Release
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
