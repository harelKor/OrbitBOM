"use client";

import { getCotsStatus } from "@/config/cots";
import { getMachine } from "@/config/machines";
import { getStatus } from "@/config/statuses";
import { computeStatus } from "@/lib/status";
import { ListPill, ListRow } from "@/components/ui/ListRow";
import { statusTint } from "@/components/ui/statusTint";
import { Icon } from "@/components/ui/Icon";
import { useInventoryPopup } from "@/components/inventory/InventoryPopup";
import { ShelfCoversPrompt } from "@/components/cots/ShelfPill";
import { MachineField, MaterialField, SLOTS, StatusField, TypeBadge, TypeField, type SaveFn } from "./fields";
import { usePermissions } from "@/components/shell/ModeContext";
import { usePartDetails } from "./PartDetailsHost";
import { CardSuggest } from "./CardSuggest";
import { partIds, partTitle, type CardPart } from "./types";

// A part as one row of the List view: thumbnail, name (a link to the product's page when it has
// one), "Qty · material", the machine it's at, its type badge (coloured like the card's) and its status, washed in
// the status colour like its card. Type, material, machines and status edit in place like on a
// card. A linked part gets a button that opens its inventory item, and a
// COTS part the shelf covers gets the In Stock? pill. Suggest (or ✓ / ✕ for a
// waiting suggestion) sits before them. A tap elsewhere opens the part's details window.
export function PartListRow({
  part,
  save,
  selected,
  onToggleSelect,
}: {
  part: CardPart;
  save: SaveFn;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const open = usePartDetails(part, save);
  const { openItem } = useInventoryPopup();
  const status = computeStatus(part);
  const statusColor = getStatus(status)?.color ?? getCotsStatus(status)?.color;
  const slots = SLOTS.filter((s) => part[s.key]);
  // The machine being worked on: the first one not done with the whole amount, else the last.
  const current = slots.find((s) => part[s.done] < Math.max(part.quantity, 1)) ?? slots.at(-1);
  const machine = current ? (getMachine(part[current.key]!)?.name ?? part[current.key]) : null;
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
      placeholder={<span className="px-1 text-center text-[10px] leading-tight text-slate-500">{part.isManual ? "Manual" : "No picture"}</span>}
      title={partTitle(part)}
      href={part.cotsLinks?.[0]?.url}
      detail={
        <span className="tabular-nums">
          Qty: <span className="font-mono">{part.quantity}</span>
          {what && (cots || !editable) && ` · ${what}`}
        </span>
      }
      pills={
        editable ? (
          // A click on a field opens its menu, not the part's window (menus are portaled, so the
          // click still bubbles through React to the row).
          <span className="contents" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {canClassify ? <TypeField part={part} save={save} badge /> : <TypeBadge part={part} />}
            {!cots && (
              <>
                {(part.material || part.inventoryItemId || work) && <MaterialField part={part} save={save} className={pill} noOpen />}
                {slots.map((slot) => (
                  <span key={slot.key} className="contents">
                    <span className="text-[10px] text-faint">→</span>
                    <MachineField part={part} save={save} slot={slot} className={`${pill} ${slot === current ? "border-accent/60 text-accent" : ""}`} />
                  </span>
                ))}
              </>
            )}
            <StatusField part={part} save={save} size="sm" />
            {cots && <ShelfCoversPrompt part={part} shelf={part.shelf ?? null} save={save} />}
          </span>
        ) : (
          <>
            <TypeBadge part={part} />
            {!cots && machine && <ListPill>{machine}</ListPill>}
            <ListPill color={statusColor}>{status}</ListPill>
          </>
        )
      }
      actions={
        <>
          <CardSuggest part={part} variant="row" />
          {part.inventoryItemId && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openItem(part.inventoryItemId!);
              }}
              className="press flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-raised text-fg-2 hover:border-sky-400/40 hover:text-accent active:scale-[0.98]"
              aria-label="Open inventory item"
              title="Open inventory item"
            >
              <Icon name="box" />
            </button>
          )}
        </>
      }
      onOpen={open}
      selected={selected}
      onToggleSelect={onToggleSelect}
    />
  );
}

const pill = "max-w-full truncate rounded-full border border-line-strong bg-ink/60 px-2.5 py-0.5 text-[11px] font-medium text-fg-2";

// The List view: rows stacked one under another (two side by side on wide screens).
export function PartList({ children }: { children: React.ReactNode }) {
  return <div className="list-stack">{children}</div>;
}
