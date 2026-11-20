"use client";

import { useState } from "react";
import { machineName } from "@/config/machines";
import { useMoveToQa } from "@/components/bom/MoveToQa";
import { useBom } from "@/components/bom/BomContext";
import { fabSteps } from "@/components/bom/PartCard";
import { StatusField, type SaveFn } from "@/components/bom/fields";
import { usePartDetails } from "@/components/bom/PartDetailsHost";
import { ownerPartId, partIds, partTitle, type CardPart } from "@/components/bom/types";
import { DrawingPreview, OutdatedDot } from "@/components/drawing/DrawingPreview";
import { useCan } from "@/components/shell/ModeContext";
import { CheckIcon } from "@/components/ui/CheckBadge";
import { Icon } from "@/components/ui/Icon";
import { ListRow } from "@/components/ui/ListRow";
import { StatusPill } from "@/components/ui/StatusPill";
import { computeStatus, partStatusLabel } from "@/lib/status";

// Clicks on a row's controls (and in windows they open) don't open the part's window.
const stopAll = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onMouseDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

const pill = "inline-flex max-w-full min-w-0 items-center truncate rounded-full border border-line-strong bg-ink/60 px-2.5 py-0.5 text-[0.6875rem] font-medium text-fg-2";
const stepBtn = "press flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-surface text-lg leading-none font-bold text-fg-2 hover:border-sky-400/40 hover:text-accent active:scale-[0.98] disabled:opacity-30";

// A To Fab part in the List view: the card's controls in one row. The picture (with the red
// Changed tag when the BOM moved past the released version), the name (no system: To Fab doesn't
// need it, Harel 2026-11-04), then the
// status (its own menu inside a batch), the material and the machine it's at, and the drawing. At
// the right end: − made/amount + (or, in To Post Process, − post-processed/amount + and the check
// that moves it on, struck through once checked). `lead` goes first there (the batch's spark).
export function FabPartListRow({
  part,
  save,
  editStatus = false,
  lead,
  post,
  checked = false,
  onCheck,
  checkFrom,
  checkTo,
  selected,
  onToggleSelect,
  style,
}: {
  part: CardPart;
  save: SaveFn;
  editStatus?: boolean;
  lead?: React.ReactNode;
  post?: { done: number; onChange: (n: number) => void };
  checked?: boolean;
  onCheck?: () => void;
  checkFrom?: string;
  checkTo?: string;
  selected?: boolean;
  onToggleSelect?: () => void;
  style?: React.CSSProperties;
}) {
  const work = useCan("work");
  const open = usePartDetails(part, save);
  const { inventory } = useBom();
  const { count, prompt: qaPrompt } = useMoveToQa(part, save, "row");
  const { machines, current, counted, finished, made, takeBack, addOne } = fabSteps(part, save, count);
  const at = current ?? machines.at(-1);
  const machine = at?.machine ? machineName(at.machine) : null;
  const linked = part.inventoryItemId ? inventory.find((i) => i.id === part.inventoryItemId) : undefined;
  const material = linked?.name ?? part.material;
  const counter = work && part.classification !== "cots" && machines.length > 0 && !post;
  const drawingFile = part.files.find((f) => f.type === "drawing");
  const [drawing, setDrawing] = useState(false);
  const title = partTitle(part);

  return (
    <div className={`relative min-w-0 ${checked ? "opacity-60" : ""}`}>
      {counter && qaPrompt}
      <ListRow
        id={`part-${part.id}`}
        data-part={partIds(part)}
        style={style}
        picture={part.thumbUrl ?? null}
        placeholder={<span className="px-1 text-center text-[0.625rem] leading-tight text-slate-500">{part.isManual ? "Manual" : "No picture"}</span>}
        title={<span className={checked ? "line-through" : undefined}>{title}</span>}
        pills={
          <span className="contents" {...stopAll}>
            {editStatus && work ? <StatusField part={part} save={save} size="sm" /> : <StatusPill status={computeStatus(part)} label={partStatusLabel(part)} />}
            {!post && <span className={pill} title="Material">{material ?? "No material"}</span>}
            {!post && machine && <span className={`${pill} border-accent/60 text-accent`} title="Machine">{machine}</span>}
            {part.fabView?.changed && (
              <span
                className="rounded-full bg-red-600 px-2 py-0.5 text-[0.625rem] font-bold tracking-wide text-white uppercase shadow-[0_0_8px_1px_rgba(220,38,38,0.45)]"
                title={`Changed in the BOM since it was released${part.fabLock?.label ? ` at ${part.fabLock.label}` : ""}. Shop Fab still shows the released version.`}
              >
                Changed
              </span>
            )}
            {(part.hasDrawing || drawingFile) && (
              <button
                type="button"
                onClick={() => setDrawing(true)}
                className="overlay-btn relative h-6 w-6"
                aria-label={part.drawingOutdated ? "View drawing (out of date)" : "View drawing"}
                title={part.drawingOutdated ? "View drawing: the part changed in Onshape since it was made" : "View drawing"}
              >
                <Icon name="drawing" className="h-3.5 w-3.5" />
                {part.drawingOutdated && <OutdatedDot />}
              </button>
            )}
          </span>
        }
        actions={
          <span className="flex items-center gap-1.5" {...stopAll}>
            {lead}
            {counter && (
              <>
                <button type="button" onClick={takeBack} disabled={!counted && !finished} className={stepBtn} aria-label="One less made">
                  −
                </button>
                <span className="min-w-10 text-center font-mono text-sm font-bold text-fg tabular-nums" title={machine ? `Made at ${machine} of the amount` : "Amount"}>
                  {made}/{part.quantity}
                </span>
                <button type="button" onClick={addOne} disabled={!current} className={stepBtn} aria-label="One more made">
                  +
                </button>
              </>
            )}
            {!counter && !post && (
              <span className="font-mono text-sm font-bold text-fg tabular-nums" title="Made of the amount">
                {made}/{part.quantity}
              </span>
            )}
            {post && work && (
              <>
                <button type="button" onClick={() => post.onChange(post.done - 1)} disabled={post.done === 0} className={stepBtn} aria-label="One less post-processed">
                  −
                </button>
                <span className="min-w-10 text-center font-mono text-sm font-bold text-fg tabular-nums" title="Post-processed of the amount">
                  {post.done}/{part.quantity}
                </span>
                <button type="button" onClick={() => post.onChange(post.done + 1)} disabled={post.done >= part.quantity} className={stepBtn} aria-label="One more post-processed">
                  +
                </button>
              </>
            )}
            {onCheck && work && (
              <button
                type="button"
                onClick={onCheck}
                aria-pressed={checked}
                className={`press flex h-10 w-10 items-center justify-center rounded-full border-2 shadow-md active:scale-[0.98] ${
                  checked ? "border-emerald-400 bg-surface text-emerald-500 hover:bg-raised" : "border-emerald-400 bg-emerald-500 text-white hover:bg-emerald-400"
                }`}
                aria-label={checked ? `Undo: put ${title} back in ${checkFrom}` : `Checked: move ${title} to ${checkTo}`}
                title={checked ? `Undo: back to ${checkFrom}` : `Checked: move to ${checkTo}`}
              >
                <CheckIcon className="h-6 w-6" />
              </button>
            )}
            {drawing && (
              <DrawingPreview
                partId={ownerPartId(part)}
                systemId={part.systemId}
                title={title}
                hasDrawing={!!part.hasDrawing}
                file={drawingFile ?? null}
                onClose={() => setDrawing(false)}
              />
            )}
          </span>
        }
        onOpen={open}
        selected={selected}
        onToggleSelect={onToggleSelect}
      />
      {checked && (
        // Checked off: a red line from the bottom-left corner to the top-right.
        <svg aria-hidden className="pointer-events-none absolute inset-0 z-10 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
          <line x1="2" y1="94" x2="98" y2="6" stroke="#dc2626" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </div>
  );
}
