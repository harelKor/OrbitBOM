"use client";

// The popover editors for each part field. The card, the table and the Kanban cards all use
// these, so a field edits the same way everywhere (ref §2a, §3).

import { getMachine } from "@/config/machines";
import type { PartChanges } from "@/lib/parts/changes";
import { PART_TAG_LABELS, partTag, type PartTag } from "@/lib/partTag";
import { computeStatus, partStatusLabel, statusMachine } from "@/lib/status";
import { STATUSES, getStatus, statusLabel } from "@/config/statuses";
import { COTS_ORDERED } from "@/config/cots";
import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import {
  COTS_STATUS_OPTIONS,
  findMaterial,
  materialOptions,
  materialValue,
  pickMaterial,
  PRIORITY_COLORS,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  machineOptions,
} from "./options";
import { useInventoryPopup } from "@/components/inventory/InventoryPopup";
import { useCan, useManage, useMode } from "@/components/shell/ModeContext";
import { NOTE_STATUSES, pickableStatuses } from "@/components/shell/mode";
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
  const locked = !useManage();
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
  const locked = !useManage();
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
  const canDraw = useCan("draw");
  const locked = !useManage() && !(field === "drawingUrl" && canDraw);
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

// A part's material is an inventory item (Raw Stock first, then the rest): picking one saves its
// name and ties the part to it.
export function MaterialField({ part, save, className }: Props & { className?: string }) {
  const locked = !useCan("work");
  const { inventory } = useBom();
  const materials = useMaterials();
  const { openItem, openMaterial } = useInventoryPopup();
  const linked = findMaterial(materials, part.inventoryItemId) ?? (part.inventoryItemId ? inventory.find((i) => i.id === part.inventoryItemId) : undefined);
  const options = materialOptions(materials);
  const label = part.material ?? linked?.name ?? <Empty />;
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
            value={materialValue(part)}
            placeholder="Search material…"
            onPick={(v) => {
              save(pickMaterial(materials, v));
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

// The material menu on its own, for forms (Bulk edit, Add Manual Part): the same list as a part's
// Material field, keeping the picked option value; pickMaterial() turns it into what to save.
export function MaterialPicker({ value, onChange, placeholder = "Material", className = "input w-auto" }: { value: string | null; onChange: (value: string | null) => void; placeholder?: string; className?: string }) {
  const options = materialOptions(useMaterials());
  const picked = value ? options.find((o) => o.value === value) : undefined;
  return (
    <Popover triggerClassName={className} trigger={<span className={`truncate ${picked ? "" : "text-subtle"}`}>{picked?.label ?? placeholder}</span>}>
      {(close) => (
        <OptionList
          options={options}
          value={value}
          placeholder="Search material…"
          onPick={(v) => {
            onChange(v);
            close();
          }}
        />
      )}
    </Popover>
  );
}

export function QuantityField({ part, save }: Props) {
  const locked = !useCan("work");
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
// Each team sees only its own statuses (pickableStatuses in mode.ts); the CAD Team's Reproduction
// and Secondary Production first ask why, and that reason joins the part's note.
export function StatusField({ part, save, size = "md" }: Props & { size?: "sm" | "md" }) {
  const locked = !useCan("work");
  const { mode } = useMode();
  const [asking, setAsking] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const status = computeStatus(part);
  const cots = part.classification === "cots";
  const machine = cots ? null : statusMachine(part);
  const pickable = pickableStatuses(mode);
  let options = cots
    ? COTS_STATUS_OPTIONS
    : machine
      ? STATUSES.map((s) => ({ value: s.name, label: statusLabel(s.name, machine), color: s.color }))
      : STATUS_OPTIONS;
  if (mode === "cad") options = NOTE_STATUSES.map((name) => ({ value: name, label: name, color: getStatus(name)?.color }));
  // Build: In Process is the part's current process, so Ready for Process 2 only with a second one.
  else if (pickable && !cots) options = options.filter((o) => o.value !== null && pickable.includes(o.value) && (o.value !== "Ready for Process 2" || !!part.process2));
  return (
    <>
      <Popover locked={locked} trigger={<StatusPill status={status} label={partStatusLabel(part)} size={size} />}>
        {(close) => (
          <OptionList
            options={options}
            value={status}
            placeholder="Search status…"
            onPick={(v) => {
              if (v && NOTE_STATUSES.includes(v) && mode === "cad") setAsking(v);
              // Edit mode releasing one made part outside the Release bar: confirm first, it locks the version for To Fab.
              else if (v === "Released" && mode === "edit" && !cots && status !== "Released") setReleasing(true);
              else if (v) save({ status: v });
              close();
            }}
          />
        )}
      </Popover>
      {releasing && (
        <ConfirmReleaseDialog
          part={part}
          onClose={() => setReleasing(false)}
          onConfirm={() => {
            save({ status: "Released" });
            setReleasing(false);
          }}
        />
      )}
      {asking && (
        <StatusNoteDialog
          part={part}
          status={asking}
          onClose={() => setAsking(null)}
          onConfirm={(reason) => {
            const line = `${asking}: ${reason}`;
            const note = (part.note?.trim() ? `${part.note.trim()}\n\n${line}` : line).slice(-2000);
            // A bought part that needs making again goes back on the Order List.
            save(cots ? { status: COTS_ORDERED, cotsSentBack: null, note } : { status: asking, note });
            setAsking(null);
          }}
        />
      )}
    </>
  );
}

// Edit mode's Released from a part's own status menu: releasing sends it to To Fab and locks the
// version it is on now, so it is confirmed rather than applied on one click.
function ConfirmReleaseDialog({ part, onClose, onConfirm }: { part: CardPart; onClose: () => void; onConfirm: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Confirm Release">
      <div className="space-y-3">
        <p className="text-sm text-fg">
          Release <span className="font-semibold">{partTitle(part)}</span>
          {part.quantity > 1 && <span className="font-mono tabular-nums"> ×{part.quantity}</span>} to fabrication?
        </p>
        <p className="text-sm text-muted">
          To Fab will keep the version it is on now. Later BOM commits won&apos;t change it there; they show a red Changed tag until the part is released again or its fab version is updated.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn active:scale-[0.98]" onClick={onClose}>
            Cancel
          </button>
          <button type="button" autoFocus className="btn-primary active:scale-[0.98]" onClick={onConfirm}>
            Confirm Release
          </button>
        </div>
      </div>
    </Dialog>
  );
}

// Why a part needs Reproduction or Secondary Production: Confirm stays off until there is a reason.
function StatusNoteDialog({ part, status, onClose, onConfirm }: { part: CardPart; status: string; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [text, setText] = useState("");
  return (
    <Dialog open onClose={onClose} title={`${status}: ${partTitle(part)}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onConfirm(text.trim());
        }}
      >
        <p className="text-sm text-muted">Why does this part need {status}? It is saved in the part&apos;s note.</p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="e.g. the bearing bore came out oversize, need a spare for the second robot…"
          className="input"
          aria-label={`Why it needs ${status}`}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn active:scale-[0.98]" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary active:scale-[0.98]" disabled={text.trim().length === 0}>
            Confirm
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function PriorityField({ part, save }: Props) {
  const locked = !useManage();
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
  const locked = !useCan("work");
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
  const locked = !useManage();
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
  const locked = !useCan("work");
  return (
    <Popover locked={locked} trigger={part.note ? <span className="line-clamp-2 max-w-48">{part.note}</span> : <Empty text="Add a note" />}>
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
