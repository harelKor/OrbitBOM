"use client";

// The popover editors for each part field. The card, the table and the Kanban cards all use
// these, so a field edits the same way everywhere (ref §2a, §3).

import { getMachine } from "@/config/machines";
import type { PartChanges } from "@/lib/parts/changes";
import { computeStatus } from "@/lib/status";
import {
  MATERIAL_OPTIONS,
  PRIORITY_COLORS,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  TYPE_LABELS,
  TYPE_OPTIONS,
  machineOptions,
} from "./options";
import { useEditMode } from "@/components/shell/ModeContext";
import { StatusPill } from "@/components/ui/StatusPill";
export { StatusPill };
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
  return <span className="text-slate-500">{text}</span>;
}

// `bare` shows the name alone (the part card shows the number beside it).
export function NameField({ part, save, bare = false }: Props & { bare?: boolean }) {
  const locked = !useEditMode();
  const name = bare ? (part.displayName ?? part.onshapeName ?? "Unnamed part") : partTitle(part);
  return (
    <Popover
      locked={locked}
      triggerClassName={bare ? "max-w-full" : ""}
      trigger={<span className={`font-semibold ${bare ? "truncate text-slate-100" : "text-accent-soft"}`}>{name}</span>}
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

export function TypeField({ part, save }: Props) {
  const locked = !useEditMode();
  return (
    <Popover locked={locked}
      trigger={
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
            part.classification === "cots" ? "border-amber-700 text-amber-300" : "border-emerald-700 text-emerald-300"
          }`}
        >
          {TYPE_LABELS[part.classification]}
        </span>
      }
    >
      {(close) => (
        <OptionList
          options={TYPE_OPTIONS}
          value={part.classification}
          onPick={(v) => {
            save({ classification: v as "inhouse" | "cots" });
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
}: Props & { field: "partNumber" | "description" | "drawingUrl"; type?: "text" | "url"; empty?: string }) {
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
  const linked = part.inventoryItemId ? inventory.find((i) => i.id === part.inventoryItemId) : undefined;
  const options = [
    ...MATERIAL_OPTIONS,
    ...inventory.map((i) => ({ value: `inv:${i.id}`, label: i.name, group: "Inventory" })),
  ];
  return (
    <Popover locked={locked} triggerClassName={className}
      trigger={
        linked ? (
          <span className="text-emerald-300" title="Drawn from the team inventory">
            {linked.name}
          </span>
        ) : (
          (part.material ?? <Empty />)
        )
      }
    >
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

export function StatusField({ part, save }: Props) {
  const status = computeStatus(part);
  return (
    <Popover trigger={<StatusPill status={status} size="md" />}>
      {(close) => (
        <OptionList
          options={STATUS_OPTIONS}
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
    <Popover locked={locked} trigger={value ?? <span className="text-slate-500 italic">Unassigned</span>}>
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
