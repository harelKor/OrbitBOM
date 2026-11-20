"use client";

// The popover editors for each part field. The card, the table and the Kanban cards all use
// these, so a field edits the same way everywhere (ref §2a, §3).

import { COTS_PROCESS, machineName } from "@/config/machines";
import type { PartChanges } from "@/lib/parts/changes";
import { PART_TAG_LABELS, partTag, type PartTag } from "@/lib/partTag";
import { areaOf, buyingNow, computeStatus, isDone, numberedFor, partStatusLabel, stageOf, statusMachine } from "@/lib/status";
import { IN_PROCESS_LATER, RELEASED_LATER, STATUSES, getStatus, processStatusName, processStatusOf, statusLabel } from "@/config/statuses";
import { COTS_ORDERED } from "@/config/cots";
import { COTS_LINK_REQUIRED, statusNeedsItem } from "@/lib/parts/cotsLink";
import { toast } from "@/components/ui/Toaster";
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
import { NOTE_STATUSES, RELEASE_STATUS, pickableStatuses } from "@/components/shell/mode";
import { ReleaseChecklist } from "./ReleaseBar";
import { FAB_SETUP_REQUIRED, missingFabSetup } from "@/lib/parts/fabSetup";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
export { StatusPill };
import { useMaterials } from "@/components/shell/MaterialColors";
import { useBom } from "./BomContext";
import { InputEditor, OptionList, Popover } from "./Popover";
import { partTitle, type CardPart } from "./types";

export type SaveFn = (changes: PartChanges) => void;
type Props = { part: CardPart; save: SaveFn };

// A part's processes: Process 1, then any number of added processes, each with its own machine,
// done count and QA tick (Harel, 2026-11-20). `n` is the process number (1 = Process 1).
export type Slot = { n: number; machine: string | null; done: number; qa: boolean; label: string };

export function slotsOf(part: Pick<CardPart, "process1" | "doneProcess1" | "addedProcesses">): Slot[] {
  return [
    { n: 1, machine: part.process1, done: part.doneProcess1, qa: false, label: "Process 1" },
    ...(part.addedProcesses ?? []).map((p, i) => ({ n: i + 2, machine: p.machine, done: p.done, qa: p.qa, label: `Process ${i + 2}` })),
  ];
}

// The process the part is at now (highlighted on the card and in the part window), or null once done.
export function currentSlotN(part: CardPart): number | null {
  if (part.classification === "cots" || isDone(part)) return null;
  return stageOf(part).index + 1;
}

// The added processes as an edit sends them (each keeps its count while its machine stays).
const addedList = (part: CardPart) => (part.addedProcesses ?? []).map((p) => ({ machine: p.machine, qa: p.qa }));

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
      trigger={<span dir="auto" className={`font-semibold ${bare ? "truncate text-fg" : "text-accent-soft"}`}>{name}</span>}
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
    <span className={`rounded-full px-2.5 py-1 text-[0.6875rem] leading-none font-bold tracking-wide shadow-sm ${TAG_BADGE[tag]}`}>
      {PART_TAG_LABELS[tag]}
    </span>
  );
}

export function TypeField({ part, save, badge = false }: Props & { badge?: boolean }) {
  // Admins and the CAD Team switch a part between COTS, In-House and Undefined.
  const locked = !useCan("classify");
  return (
    <Popover locked={locked}
      hideCaret={badge}
      trigger={
        badge ? (
          <TypeBadge part={part} />
        ) : (
          <span
            className={`rounded border px-1.5 py-0.5 text-[0.625rem] font-semibold ${
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
// `noOpen`: no box button beside it (the part card keeps its material line clean).
export function MaterialField({ part, save, className, noOpen = false, placeholder }: Props & { className?: string; noOpen?: boolean; placeholder?: string }) {
  const locked = !useCan("work");
  const { inventory } = useBom();
  const materials = useMaterials();
  const { openItem, openMaterial } = useInventoryPopup();
  const linked = findMaterial(materials, part.inventoryItemId) ?? (part.inventoryItemId ? inventory.find((i) => i.id === part.inventoryItemId) : undefined);
  const options = materialOptions(materials);
  const label = part.material ?? linked?.name ?? <Empty text={placeholder} />;
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
      {linked && openStock && !noOpen && (
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
// and Secondary Production first ask why, and that reason joins the part's note. The CAD Team can
// also release a part here, through the Release bar's checklist (Harel, 2026-11-04).
export function StatusField({ part, save, size = "md" }: Props & { size?: "sm" | "md" }) {
  const locked = !useCan("work");
  const { mode } = useMode();
  const [asking, setAsking] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [checking, setChecking] = useState(false);
  const status = computeStatus(part);
  // A part bought as its Process 1 goes through the COTS statuses until it arrives (Harel, 2026-11-20).
  const cots = part.classification === "cots" || buyingNow(part);
  const machine = cots ? null : statusMachine(part);
  const area = cots ? null : areaOf(part);
  const pickable = pickableStatuses(mode, area);
  let options = cots
    ? COTS_STATUS_OPTIONS
    : (machine
        ? STATUSES.map((s) => ({ value: s.name as string | null, label: statusLabel(s.name, machine), color: s.color as string | undefined }))
        : STATUS_OPTIONS
      ).flatMap((o) => {
        // Released P2+ / In Process 2+: one choice per added process; none without one.
        if (o.value !== RELEASED_LATER && o.value !== IN_PROCESS_LATER) return [o];
        const group = o.value;
        return (part.addedProcesses ?? []).map((_, i) => ({ value: processStatusName(group, i + 2), label: processStatusName(group, i + 2), color: o.color }));
      });
  const groupOf = (v: string) => processStatusOf(v)?.group ?? v;
  // A Factory Fab factory's or team printer's part: only that area's statuses.
  if (area) options = options.filter((o) => o.value !== null && pickable!.includes(groupOf(o.value)));
  else if (mode === "cad") options = [RELEASE_STATUS, ...NOTE_STATUSES].map((name) => ({ value: name, label: name, color: getStatus(name)?.color }));
  else if (pickable && !cots) options = options.filter((o) => o.value !== null && pickable.includes(groupOf(o.value)));
  // The CAD Team doesn't release a part that already is.
  if (mode === "cad" && status === RELEASE_STATUS) options = options.filter((o) => o.value !== RELEASE_STATUS);
  return (
    <>
      <Popover locked={locked || !options.length} trigger={<StatusPill status={status} label={partStatusLabel(part)} size={size} />}>
        {(close) => (
          <OptionList
            options={options}
            value={cots ? status : (numberedFor(part, status) ?? status)}
            placeholder="Search status…"
            onPick={(v) => {
              // A COTS part goes to Released or the Order List only once it is linked to its inventory item.
              if (v && cots && !part.inventoryItemId && statusNeedsItem(mode === "cad" && NOTE_STATUSES.includes(v) ? COTS_ORDERED : v)) toast(COTS_LINK_REQUIRED, true);
              else if (v && NOTE_STATUSES.includes(v) && mode === "cad") setAsking(v);
              else if (v === RELEASE_STATUS && missingFabSetup(part)) toast(FAB_SETUP_REQUIRED, true);
              else if (v === RELEASE_STATUS && mode === "cad") setChecking(true);
              // Edit mode releasing one made part outside the Release bar: confirm first, it locks the version for To Fab.
              else if (v === "Released" && mode === "edit" && !cots && status !== "Released") setReleasing(true);
              else if (v) save({ status: v });
              close();
            }}
          />
        )}
      </Popover>
      {checking && (
        <ReleaseChecklist
          count={1}
          parts={[part]}
          onClose={() => setChecking(false)}
          onConfirm={() => {
            save({ status: RELEASE_STATUS });
            setChecking(false);
          }}
        />
      )}
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
          Shop Fab will keep the version it is on now. Later BOM commits won&apos;t change it there; they show a red Changed tag until the part is released again or its fab version is updated.
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
export function StatusNoteDialog({ part, status, onClose, onConfirm }: { part: CardPart; status: string; onClose: () => void; onConfirm: (reason: string) => void }) {
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

// Process 1 offers COTS too: bought, then QA, then its added processes (Harel, 2026-11-20).
const PROCESS1_OPTIONS = () => [...machineOptions("Process"), { value: COTS_PROCESS, label: "COTS" }];

// A process's machine. Process 1's "— None —" clears it; an added process's takes it away.
export function MachineField({ part, save, slot, placeholder, className }: Props & { slot: Slot; placeholder?: string; className?: string }) {
  const locked = !useCan("work");
  const name = slot.machine ? machineName(slot.machine) : null;
  return (
    <Popover locked={locked} triggerClassName={className} trigger={name ?? <Empty text={placeholder} />}>
      {(close) => (
        <OptionList
          options={slot.n === 1 ? PROCESS1_OPTIONS() : machineOptions("Process").map((o) => (o.value === null ? { ...o, label: "— Remove this process —" } : o))}
          value={slot.machine}
          onPick={(v) => {
            if (slot.n === 1) save({ process1: v });
            else {
              const list = addedList(part);
              save({ addedProcesses: v ? list.map((p, i) => (i === slot.n - 2 ? { ...p, machine: v } : p)) : list.filter((_, i) => i !== slot.n - 2) });
            }
            close();
          }}
        />
      )}
    </Popover>
  );
}

// "+ Add process": a machine for a new process after the last one (Harel, 2026-11-20).
export function AddProcessField({ part, save, className, label = "+ Add process" }: Props & { className?: string; label?: string }) {
  const locked = !useCan("work");
  if (locked) return null;
  return (
    <Popover triggerClassName={className} trigger={<span className="text-subtle">{label}</span>}>
      {(close) => (
        <OptionList
          options={machineOptions("Process").filter((o) => o.value !== null)}
          value={null}
          placeholder="Search machine…"
          onPick={(v) => {
            if (v) save({ addedProcesses: [...addedList(part), { machine: v, qa: false }] });
            close();
          }}
        />
      )}
    </Popover>
  );
}

// An added process's QA tick, shown on the row of the process before it as "QA after": QA once
// that one is done, before this one starts (Harel, 2026-11-20).
export function QaNeededField({ part, save, slot }: Props & { slot: Slot }) {
  const locked = !useCan("work");
  // After a bought Process 1 QA comes anyway, like any COTS part's: no tick (Harel, 2026-11-20).
  if (slot.n === 2 && part.process1 === COTS_PROCESS) return null;
  return (
    <label className={`inline-flex shrink-0 items-center gap-1.5 text-xs text-muted ${locked ? "" : "cursor-pointer"} pointer-coarse:min-h-9`} title={`QA after this process, before Process ${slot.n} starts`}>
      <input
        type="checkbox"
        disabled={locked}
        checked={slot.qa}
        onChange={(e) => save({ addedProcesses: addedList(part).map((p, i) => (i === slot.n - 2 ? { ...p, qa: e.target.checked } : p)) })}
        className="h-4 w-4 accent-[var(--accent)]"
      />
      QA after
    </label>
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
    <Popover locked={locked} trigger={part.note ? <span dir="auto" className="line-clamp-2 max-w-48">{part.note}</span> : <Empty text="Add a note" />}>
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

// The processes the part window lists: Process 1 always, then each added one.
export const machineSlotsShown = (part: CardPart): Slot[] => slotsOf(part);
