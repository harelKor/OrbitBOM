"use client";

import { getCotsStatus } from "@/config/cots";
import { machineName } from "@/config/machines";
import { getStatus } from "@/config/statuses";
import { computeStatus } from "@/lib/status";
import { ListPill, ListRow } from "@/components/ui/ListRow";
import { statusTint } from "@/components/ui/statusTint";
import { ShelfCoversPrompt } from "@/components/cots/ShelfPill";
import { MachineField, MaterialField, StatusField, TypeBadge, TypeField, currentSlotN, slotsOf, type SaveFn } from "./fields";
import { usePermissions } from "@/components/shell/ModeContext";
import { usePartDetails } from "./PartDetailsHost";
import { CardSuggest } from "./CardSuggest";
import { DataBadges } from "./PartCard";
import { partIds, partTitle, type CardPart } from "./types";

// A part as one row of the List view: thumbnail, name (a link to the product's page when it has
// one), "Qty · material", the machine it's at, its type badge (coloured like the card's) and its status, washed in
// the status colour like its card. Type, material, machines and status edit in place like on a
// card. A COTS part the shelf covers gets the In Stock? pill. Suggest (or ✓ / ✕ for a waiting
// suggestion) sits at the end. A tap elsewhere opens the part's details window (or `onOpen`).
export function PartListRow({
  part,
  save,
  selected,
  onToggleSelect,
  onOpen,
  title,
  order,
}: {
  part: CardPart;
  save: SaveFn;
  selected?: boolean;
  onToggleSelect?: () => void;
  onOpen?: () => void; // instead of the part window (COTS opens the inventory item window)
  title?: string; // the order pages: the order line's name
  // The order pages (Harel, 2026-11-24): the row's detail line, what's added after its pills (the
  // amount to order), and `item` for an inventory item sent there (no COTS type pill).
  order?: { detail?: React.ReactNode; extra?: React.ReactNode; item?: boolean };
}) {
  const open = usePartDetails(part, save);
  const status = computeStatus(part);
  const statusColor = getStatus(status)?.color ?? getCotsStatus(status)?.color;
  const slots = slotsOf(part).filter((s) => s.machine);
  // The process the part is at now, else its last one.
  const atN = currentSlotN(part);
  const current = slots.find((s) => s.n === atN) ?? slots.at(-1);
  const machine = current?.machine ? machineName(current.machine) : null;
  const cots = part.classification === "cots";
  const what = cots ? (part.shelf?.itemName ?? null) : part.material;
  const { canWork: work, canClassify } = usePermissions();
  // Outside a selection the type, material, machines and status open their editors like the
  // card's (each field locks itself for a team that can't change it); while selecting they're plain pills.
  const editable = !onToggleSelect;
  return (
    <ListRow
      id={`part-${part.id}`}
      data-part={partIds(part)}
      style={statusTint(status)}
      picture={part.thumbUrl ?? (cots ? (part.shelf?.thumbUrl ?? null) : null)}
      placeholder={<span className="px-1 text-center text-[0.625rem] leading-tight text-slate-500">{part.isManual && !order?.item ? "Manual" : "No picture"}</span>}
      title={title ?? partTitle(part)}
      href={part.cotsLinks?.[0]?.url}
      detail={
        order?.detail ?? <span className="tabular-nums">
          Qty: <span className="font-mono">{part.quantity}</span>
          {what && (cots || !editable) && ` · ${what}`}
        </span>
      }
      pills={
        editable ? (
          // A click on a field opens its menu, not the part's window (menus are portaled, so the
          // click still bubbles through React to the row).
          <span
            className="contents"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {!order?.item && (canClassify ? <TypeField part={part} save={save} badge /> : <TypeBadge part={part} />)}
            {!order?.item && <DataBadges part={part} />}
            {!cots && (
              <>
                {part.material || part.inventoryItemId ? (
                  <MaterialField part={part} save={save} className={pill} noOpen />
                ) : (
                  // No material yet: a dashed "+ Material" pill picks one right here.
                  work && <MaterialField part={part} save={save} className={addPill} noOpen placeholder="+ Material" />
                )}
                {!slots.length && work && (
                  <span className="contents">
                    <span className="text-[0.625rem] text-faint">→</span>
                    <MachineField part={part} save={save} slot={slotsOf(part)[0]} placeholder="+ Process" className={addPill} />
                  </span>
                )}
                {slots.map((slot) => (
                  <span key={slot.n} className="contents">
                    <span className="text-[0.625rem] text-faint">→</span>
                    <MachineField part={part} save={save} slot={slot} className={`${pill} ${slot.n === atN ? "border-accent/60 bg-accent/10 font-semibold text-accent" : ""}`} />
                  </span>
                ))}
              </>
            )}
            <StatusField part={part} save={save} size="sm" />
            {cots && <ShelfCoversPrompt part={part} shelf={part.shelf ?? null} save={save} />}
            {order?.extra}
          </span>
        ) : (
          <>
            {!order?.item && <TypeBadge part={part} />}
            {!order?.item && <DataBadges part={part} />}
            {!cots && machine && <ListPill>{machine}</ListPill>}
            <ListPill color={statusColor}>{status}</ListPill>
            {order?.extra}
          </>
        )
      }
      actions={<CardSuggest part={part} variant="row" />}
      onOpen={onOpen ?? open}
      selected={selected}
      onToggleSelect={onToggleSelect}
    />
  );
}

// A field with nothing in it yet, waiting to be picked.
const addPill = "max-w-full truncate rounded-full border border-dashed border-line-strong px-2.5 py-0.5 text-[0.6875rem] font-medium text-muted hover:border-sky-400/40 hover:text-accent";
const pill = "max-w-full truncate rounded-full border border-line-strong bg-ink/60 px-2.5 py-0.5 text-[0.6875rem] font-medium text-fg-2";

// The List view: rows stacked one under another (two side by side on wide screens).
export function PartList({ children }: { children: React.ReactNode }) {
  return <div className="list-stack">{children}</div>;
}
