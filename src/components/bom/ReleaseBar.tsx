"use client";

import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { Checkbox } from "@/components/ui/Checkbox";
import { Icon } from "@/components/ui/Icon";
import { Thumb } from "./Thumb";
import { COTS_LINK_REQUIRED } from "@/lib/parts/cotsLink";
import { FAB_SETUP_REQUIRED, missingFabSetup } from "@/lib/parts/fabSetup";
import { isUnreleased } from "@/lib/status";
import { openPartWindow } from "./PartDetailsHost";
import type { CardPart } from "./types";

export { missingFabSetup };

// The status Release gives the selected parts.
export const RELEASED_STATUS = "Released";

// A COTS part Release can't send to the COTS page: it has no inventory item yet.
export const unlinkedCots = (p: CardPart) => p.classification === "cots" && !p.inventoryItemId;

// A made part with no fabrication drawing yet (made on the system page's Drawings, or uploaded).
export const missingDrawing = (p: CardPart) => p.classification !== "cots" && !p.hasDrawing && !p.files.some((f) => f.type === "drawing");

// Why a selected part is left out of the release, or null. A part released already (in process,
// finished, ordered) keeps its status and counts: Select all → Release used to send it back to
// Released (audit 2026-11-25, BOM-4).
const ALREADY = "Already released";
// A status menu's own Released (one part, picked on purpose) isn't held back as already released.
const heldBack = (p: CardPart, bar = true) => (bar && !isUnreleased(p) ? ALREADY : unlinkedCots(p) ? "Not linked" : missingFabSetup(p) ? "No machine or material" : null);

// What the releasing member confirms first, every box ticked (Harel, 2026-10-30).
const CHECKS = [
  "Were the parts reviewed by a mentor/CAD lead?",
  "Did you check them against the rest of the robot assembly?",
  "Did you check drill sizes and general fabricating constraints?",
];

function UnplacedWarning({ count }: { count: number }) {
  return (
    <p role="alert" className="flex items-center gap-2 rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-500">
      <span aria-hidden className="font-bold">✕</span>
      <span>
        {FAB_SETUP_REQUIRED} <span className="font-mono tabular-nums">{count}</span> selected {count === 1 ? "part has" : "parts have"} none and won&apos;t be released.
      </span>
    </p>
  );
}

function NoDrawingWarning({ count }: { count: number }) {
  return (
    <p role="alert" className="flex items-center gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-500">
      <span aria-hidden className="font-bold">!</span>
      <span>
        <span className="font-mono tabular-nums">{count}</span> {count === 1 ? "part has" : "parts have"} no drawing.
      </span>
    </p>
  );
}

function AlreadyNote({ count }: { count: number }) {
  return (
    <p className="flex items-center gap-2 rounded-md border border-line-strong bg-raised/60 px-3 py-2 text-sm text-muted">
      <span className="font-mono tabular-nums">{count}</span> selected {count === 1 ? "part is" : "parts are"} released already and stay{count === 1 ? "s" : ""} as {count === 1 ? "it is" : "they are"}.
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
// marks them Released. Parts To Fab can't place (no machine or material) and COTS parts with no
// inventory item are left out (onRelease gets the ids that may be released); the server refuses
// them too (statusChangeDenied, Harel 2026-11-13).
export function ReleaseBar({ count, selected, total, onRelease, onRemove, onSelectAll, onDone }: { count: number; selected: CardPart[]; total: number; onRelease: (ids: string[]) => void; onRemove: (id: string) => void; onSelectAll: () => void; onDone: () => void }) {
  const fresh = selected.filter(isUnreleased);
  const already = selected.length - fresh.length;
  const unplaced = fresh.filter(missingFabSetup).length;
  const unlinked = fresh.filter(unlinkedCots).length;
  const releasable = selected.filter((p) => !heldBack(p));
  const releaseCount = releasable.length;
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="fixed bottom-0 left-[var(--shell-left)] right-[var(--shell-right)] z-40 border-t border-line-strong bg-surface/95 p-3 backdrop-blur">
      {(unplaced > 0 || unlinked > 0 || already > 0) && (
        <div className="mx-auto mb-2 flex max-w-5xl flex-col gap-2">
          {already > 0 && <AlreadyNote count={already} />}
          {unlinked > 0 && <UnlinkedWarning count={unlinked} />}
          {unplaced > 0 && <UnplacedWarning count={unplaced} />}
        </div>
      )}
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 text-sm">
        <span className="font-mono font-semibold tabular-nums">{count} selected</span>
        <button className="btn-primary active:scale-[0.98]" disabled={!releaseCount} onClick={() => setConfirming(true)}>
          Release
        </button>
        <button className="btn active:scale-[0.98]" onClick={onSelectAll}>
          Select all (<span className="font-mono tabular-nums">{total}</span>)
        </button>
        <button className="btn ml-auto active:scale-[0.98]" onClick={onDone}>
          Cancel
        </button>
      </div>
      {confirming && (
        <ReleaseChecklist
          count={releaseCount}
          parts={selected}
          bar
          onRemove={(id) => {
            if (selected.length === 1) setConfirming(false);
            onRemove(id);
          }}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            onRelease(releasable.map((p) => p.id));
          }}
        >
          {already > 0 && <AlreadyNote count={already} />}
          {unlinked > 0 && <UnlinkedWarning count={unlinked} />}
          {unplaced > 0 && <UnplacedWarning count={unplaced} />}
        </ReleaseChecklist>
      )}
    </div>
  );
}

// The Release checklist: every box ticked before Confirm Release. Used by the Release bar and by a
// card's status menu when the CAD Team picks Released (Harel, 2026-11-04). `children`: warnings.
// `parts`: the selected parts, each a thumbnail and name that opens the part's window, with an X
// that takes it out of the release (only with `onRemove`), tagged when it has no drawing or is held
// back (Harel, 2026-11-13).
export function ReleaseChecklist({ count, parts, bar = false, onRemove, onClose, onConfirm, children }: { count: number; parts?: CardPart[]; bar?: boolean; onRemove?: (id: string) => void; onClose: () => void; onConfirm: () => void; children?: React.ReactNode }) {
  const [ticked, setTicked] = useState<boolean[]>(() => CHECKS.map(() => false));
  const noDrawing = parts?.filter((p) => !heldBack(p, bar) && missingDrawing(p)).length ?? 0;
  return (
    <Dialog
      open
      onClose={onClose}
      title={
        <>
          Release <span className="font-mono tabular-nums">{count}</span> {count === 1 ? "part" : "parts"}
        </>
      }
    >
      <div className="space-y-3">
        {children}
        {!!noDrawing && <NoDrawingWarning count={noDrawing} />}
        {!!parts?.length && (
          <ul className="grid max-h-64 grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 overflow-y-auto">
            {parts.map((p) => {
              const name = p.displayName ?? p.onshapeName ?? "Unnamed part";
              const held = heldBack(p, bar);
              const tag = held ?? (missingDrawing(p) ? "No drawing" : null);
              const tagColor = held === ALREADY ? "text-muted" : held ? "text-rose-500" : "text-amber-500";
              return (
                <li key={p.id} className={`relative rounded-lg border bg-raised/40 ${held === ALREADY ? "border-line opacity-60" : held ? "border-rose-500/50 opacity-60" : "border-line"}`}>
                  {/* Opens the part's window on top; this one stays open under it. */}
                  <button
                    type="button"
                    onClick={() => void openPartWindow(p.id)}
                    title={`Open ${name}`}
                    className="press flex w-full flex-col items-center gap-1 rounded-lg p-2 hover:bg-raised active:scale-[0.98]"
                  >
                    <Thumb part={p} size={72} />
                    <span className="w-full truncate text-center text-xs font-medium">{name}</span>
                    {tag && <span className={`text-[0.6875rem] font-semibold ${tagColor}`}>{tag}</span>}
                  </button>
                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(p.id)}
                      aria-label={`Don't release ${name}`}
                      title="Don't release this part"
                      className="press absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-surface/90 text-subtle hover:bg-rose-500 hover:text-white active:scale-[0.98] pointer-coarse:h-9 pointer-coarse:w-9"
                    >
                      <Icon name="close" className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
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
          <button type="button" className="btn active:scale-[0.98]" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary active:scale-[0.98]" disabled={!count || !ticked.every(Boolean)} onClick={onConfirm}>
            Confirm Release
          </button>
        </div>
      </div>
    </Dialog>
  );
}
