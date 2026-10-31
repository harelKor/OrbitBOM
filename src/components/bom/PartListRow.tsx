"use client";

import { getCotsStatus } from "@/config/cots";
import { getMachine } from "@/config/machines";
import { getStatus } from "@/config/statuses";
import { siteOf } from "@/lib/cots";
import { computeStatus } from "@/lib/status";
import { ListPill, ListRow } from "@/components/ui/ListRow";
import { SLOTS, type SaveFn } from "./fields";
import { usePartDetails } from "./PartDetailsHost";
import { partIds, partTitle, type CardPart } from "./types";

// A part as one row of the List view: thumbnail, name, "Qty · material", the machine it's at
// (COTS: the product's site) and its status. A tap opens the part's details window.
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
  const status = computeStatus(part);
  const statusColor = getStatus(status)?.color ?? getCotsStatus(status)?.color;
  const slots = SLOTS.filter((s) => part[s.key]);
  // The machine being worked on: the first one not done with the whole amount, else the last.
  const current = slots.find((s) => part[s.done] < Math.max(part.quantity, 1)) ?? slots.at(-1);
  const machine = current ? (getMachine(part[current.key]!)?.name ?? part[current.key]) : null;
  const cots = part.classification === "cots";
  const what = cots ? (part.shelf?.itemName ?? null) : part.material;
  return (
    <ListRow
      id={`part-${part.id}`}
      data-part={partIds(part)}
      picture={part.thumbUrl ?? (cots ? (part.shelf?.thumbUrl ?? null) : null)}
      placeholder={<span className="px-1 text-center text-[10px] leading-tight text-slate-500">{part.isManual ? "Manual" : "No picture"}</span>}
      title={partTitle(part)}
      detail={
        <span className="tabular-nums">
          Qty: <span className="font-mono">{part.quantity}</span>
          {what && ` · ${what}`}
        </span>
      }
      pills={
        <>
          {cots ? <ListPill>{part.cotsLinks[0] ? siteOf(part.cotsLinks[0]) : "COTS"}</ListPill> : machine && <ListPill>{machine}</ListPill>}
          <ListPill color={statusColor}>{status}</ListPill>
        </>
      }
      onOpen={open}
      selected={selected}
      onToggleSelect={onToggleSelect}
    />
  );
}

// The List view: rows stacked one under another (two side by side on wide screens).
export function PartList({ children }: { children: React.ReactNode }) {
  return <div className="list-stack">{children}</div>;
}
