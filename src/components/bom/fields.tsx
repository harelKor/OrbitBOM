"use client";

// The popover editors for each part field. The card, the table and the Kanban cards all use
// these, so a field edits the same way everywhere (ref §2a, §3).

import { getMachine } from "@/config/machines";
import type { PartChanges } from "@/lib/parts/changes";
import { PART_TAG_LABELS, partTag, type PartTag } from "@/lib/partTag";
import { computeStatus, partStatusLabel, statusMachine } from "@/lib/status";
import { STATUSES, statusLabel } from "@/config/statuses";
import {
  COTS_STATUS_OPTIONS,
  materialOptions,
  PRIORITY_COLORS,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  machineOptions,
} from "./options";
import { useInventoryPopup } from "@/components/inventory/InventoryPopup";
import { useEditMode } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
export { StatusPill };
import { useMaterials } from "@/components/shell/MaterialColors";
import { useBom } from "./BomContext";
import { InputEditor, OptionList, Popover } from "./Popover";
import { partTitle, type CardPart } from "./types";

export type SaveFn = (changes: PartChanges) => void;
type Props = { part: CardPart; save: SaveFn };

export const SLOTS = [
  { key: "preProcess", done: "donePreprocess", label: "Pre Process", stage: "PreProcess" },
  { key: "process1", done: "doneProcess1", label: "Process 1", stage: "Process" },
  { key: "process2", done: "doneProcess2", label: "Process 2", stage: "Process" },
] as const;
export type Slot = (typeof SLOTS)[number];

export function Empty({ text = "—" }: { text?: string }) {
  return <span className="text-subtle">{text}</span>;
}

// `bare` is the part card's plain, truncating style.
export function NameField({ part, save, bare = false }: Props & { bare?: boolean }) {
  const locked = !useEditMode();
  const name = partTitle(part);
  return (
    <Popover
      locked={locked}
      triggerClassName={bare ? "max-w-full" : ""}
      trigger={<span className={`font-semibold ${bare ? "truncate text-fg" : "text-accent-soft"}`}>{name}</span>}
    >
      {(close) => (
        <InputEditor
          value={part.displayName ?? part.onshapeName ?? ""}
          onCancel={close}
          onSave={(v) => {
            save({ displayName: v || null });
            close();
          }}
        />
      )}
    </Popover>
  );
}

// The bold tag over a part card's thumbnail: gold for bought (COTS), green for made by a partner
// factory (In factory), Orbit blue for made by the team (In-house).
const TAG_BADGE: Record<PartTag, string> = {
  cots: "bg-amber-400 text-amber-950",
  factory: "bg-emerald-600 text-white",
  inhouse: "bg-accent text-white",
  undefined: "bg-slate-500 text-white",
};
export function TypeBadge({ part }: { part: CardPart }) {
  const tag = partTag(part);
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] leading-none font-bold tracking-wide shadow-sm ${TAG_BADGE[tag]}`}>
      {PART_TAG_LABELS[tag]}
    </span>
  );
}

export function TypeField({ part, save, badge = false }: Props & { badge?: boolean }) {
  const locked = !useEditMode();
  return (
    <Popover locked={locked}
      hideCaret={badge}
      trigger={
        badge ? (
          <TypeBadge part={part} />
        ) : (
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
              part.classification === "cots" ? "border-amber-300 text-amber-700" : "border-emerald-300 text-emerald-700"
            }`}
          >
            {PART_TAG_LABELS[partTag(part)]}
          </span>
        )
      }
    >
      {(close) => (
        <OptionList
          options={TYPE_OPTIONS}
          value={part.classification}
          onPick={(v) => {
            save({ classification: v as "inhouse" | "cots" | "undefined" });
            close();
          }}
        />
      )}
    </Popover>
  );
}

export function TextField({
  part,
  save,
  field,
  type = "text",
  empty,
}: Props & { field: "description" | "drawingUrl"; type?: "text" | "url"; empty?: string }) {
  const locked = !useEditMode();
  return (
    <Popover locked={locked} trigger={part[field] ?? <Empty text={empty} />}>
      {(close) => (
        <InputEditor
          type={type}
          value={part[field] ?? ""}
          onCancel={close}
          onSave={(v) => {
            save({ [field]: v.trim() || null });
            close();
          }}
        />
      )}
    </Popover>
  );
}

// Materials, then the team's inventory items: picking an item ties the part to it (ref §5).
export function MaterialField({ part, save, className }: Props & { className?: string }) {
  const locked = !useEditMode();
  const { inventory } = useBom();
  const materials = useMaterials();
  const { openItem, openMaterial } = useInventoryPopup();
  const linked = part.inventoryItemId ? inventory.find((i) => i.id === part.inventoryItemId) : undefined;
  const options = [
    ...materialOptions(materials),
    ...inventory.map((i) => ({ value: `inv:${i.id}`, label: i.name, group: "Inventory" })),
  ];
  const label = linked ? (
    <span className="text-emerald-700" title="Drawn from the team inventory">
      {linked.name}
    </span>
  ) : (
    (part.material ?? <Empty />)
  );
  // The material's stock opens in a window over the page (View: tap the material; Edit: the box).
  const openStock = linked ? () => openItem(linked.id) : part.material ? () => openMaterial(part.material!) : null;
  if (locked)
    return openStock ? (
      <button type="button" onClick={openStock} className={`press inline-flex items-center gap-1 rounded text-left hover:text-accent ${className ?? ""}`} title="See it in the inventory">
        {label}
      </button>
    ) : (
      <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>{label}</span>
    );
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Popover triggerClassName={className} trigger={label}>
        {(close) => (
          <OptionList
            options={options}
            value={linked ? `inv:${linked.id}` : part.material}
            onPick={(v) => {
              if (v?.startsWith("inv:")) save({ inventoryItemId: v.slice(4) });
              else save({ material: v, ...(part.inventoryItemId ? { inventoryItemId: null } : {}) });
              close();
            }}
          />
        )}
      </Popover>
      {linked && openStock && (
        <button type="button" onClick={openStock} className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-subtle hover:border-accent hover:text-accent" aria-label="See it in the inventory" title="See it in the inventory">
          <Icon name="box" className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

export function QuantityField({ part, save }: Props) {
  const locked = !useEditMode();
  return (
    <Popover locked={locked} trigger={part.quantity}>
      {(close) => (
        <InputEditor
          type="number"
          value={String(part.quantity)}
          onCancel={close}
          onSave={(v) => {
            save({ quantity: Number(v) });
            close();
          }}
        />
      )}
    </Popover>
  );
}

// The status menu names each status as the part's machine calls it ("Printing" on a 3D printer).
export function StatusField({ part, save, size = "md" }: Props & { size?: "sm" | "md" }) {
  const status = computeStatus(part);
  const machine = part.classification === "cots" ? null : statusMachine(part);
  const options =
    part.classification === "cots"
      ? COTS_STATUS_OPTIONS
      : machine
        ? STATUSES.map((s) => ({ value: s.name, label: statusLabel(s.name, machine), color: s.color }))
        : STATUS_OPTIONS;
  return (
    <Popover trigger={<StatusPill status={status} label={partStatusLabel(part)} size={size} />}>
      {(close) => (
        <OptionList
          options={options}
          value={status}
          placeholder="Search status…"
          onPick={(v) => {
            if (v) save({ status: v });
            close();
          }}
        />
      )}
    </Popover>
  );
}

export function PriorityField({ part, save }: Props) {
  const locked = !useEditMode();
  return (
    <Popover locked={locked}
      trigger={
        <span className="rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ background: PRIORITY_COLORS[part.priority] }}>
          {part.priority[0].toUpperCase() + part.priority.slice(1)}
        </span>
      }
    >
      {(close) => (
        <OptionList
          options={PRIORITY_OPTIONS}
          value={part.priority}
          onPick={(v) => {
            save({ priority: v as CardPart["priority"] });
            close();
          }}
        />
      )}
    </Popover>
  );
}

export function MachineField({ part, save, slot, placeholder, className }: Props & { slot: Slot; placeholder?: string; className?: string }) {
  const locked = !useEditMode();
  const machineId = part[slot.key];
  const name = machineId ? (getMachine(machineId)?.name ?? machineId) : null;
  return (
    <Popover locked={locked} triggerClassName={className} trigger={name ?? <Empty text={placeholder} />}>
      {(close) => (
        <OptionList
          options={machineOptions(slot.stage)}
          value={machineId}
          onPick={(v) => {
            save({ [slot.key]: v });
            close();
          }}
        />
      )}
    </Popover>
  );
}

export function PersonField({
  value,
  names,
  onSave,
}: {
  value: string | null;
  names: string[];
  onSave: (value: string | null) => void;
}) {
  const locked = !useEditMode();
  return (
    <Popover locked={locked} trigger={value ?? <span className="text-subtle italic">Unassigned</span>}>
      {(close) => (
        <InputEditor
          value={value ?? ""}
          suggestions={names}
          onCancel={close}
          onSave={(v) => {
            onSave(v.trim() || null);
            close();
          }}
        />
      )}
    </Popover>
  );
}

export function NoteField({ part, save }: Props) {
  return (
    <Popover trigger={part.note ? <span className="line-clamp-2 max-w-48">{part.note}</span> : <Empty text="Add a note" />}>
      {(close) => (
        <InputEditor
          multiline
          value={part.note ?? ""}
          onCancel={close}
          onSave={(v) => {
            save({ note: v });
            close();
          }}
        />
      )}
    </Popover>
  );
}

// Pre Process only lists PreProcess-stage machines; hide the slot when there are none and it's empty.
export function machineSlotsShown(part: CardPart): Slot[] {
  return SLOTS.filter((slot) => part[slot.key] || machineOptions(slot.stage).length > 1);
}
