"use client";

import { useTransition } from "react";
import { getMachine } from "@/config/machines";
import { isDone } from "@/lib/status";
import { deleteManualPart, unmergeParts } from "@/app/(app)/parts-actions";
import {
  DeadlineField,
  MachineField,
  MaterialField,
  NameField,
  PersonField,
  PriorityField,
  QuantityField,
  SLOTS,
  StatusField,
  TextField,
  TypeField,
  machineSlotsShown,
  type SaveFn,
} from "./fields";
import { FilesField } from "./FilesField";
import { textOn } from "./options";
import { Popover, InputEditor } from "./Popover";
import { ownerPartId, partTitle, type CardPart } from "./types";

export function PartCard({
  part,
  save,
  memberNames,
  showSystem = false,
  selected,
  onToggleSelect,
}: {
  part: CardPart;
  save: SaveFn;
  memberNames: string[];
  showSystem?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void; // set while a selection mode (Bulk edit) is on
}) {
  const [, startTransition] = useTransition();
  const done = isDone(part);
  const currentSlot = SLOTS.find((s) => part[s.key] && part[s.done] < Math.max(part.quantity, 1));

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-xl border text-sm ${
        selected ? "border-indigo-400 ring-2 ring-indigo-500" : done ? "border-emerald-800" : "border-slate-800"
      } ${done ? "bg-emerald-950/40" : "bg-slate-900"}`}
    >
      {onToggleSelect && (
        // In a selection mode, clicking anywhere on the card toggles it, as in FRCBOM.
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={selected}
          aria-label={selected ? "Deselect part" : "Select part"}
          className="absolute inset-0 z-20 flex items-start justify-end p-3"
        >
          <span
            className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${
              selected ? "border-indigo-400 bg-indigo-500 text-white" : "border-slate-500 bg-slate-900"
            }`}
          >
            {selected ? "✓" : ""}
          </span>
        </button>
      )}
      <div className="flex h-28 items-center justify-center bg-slate-800/50 text-xs text-slate-600">
        {part.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
          <img src={part.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain" />
        ) : part.isManual ? (
          "Manual part"
        ) : (
          "No thumbnail yet"
        )}
      </div>
      <div className="space-y-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <NameField part={part} save={save} />
          <TypeField part={part} save={save} />
        </div>
        {!part.memberIds && part.onshapeName && part.displayName && part.displayName !== part.onshapeName && (
          <div className="text-xs text-slate-500">Onshape: {part.onshapeName}</div>
        )}
        {showSystem && <div className="text-xs text-slate-500">{part.systemName}</div>}
        {part.memberIds && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            ⧉ Merged from {part.memberIds.length} parts
            <button className="text-indigo-300 hover:text-indigo-200" onClick={() => startTransition(() => void unmergeParts(part.id))}>
              Unmerge
            </button>
          </div>
        )}
        {part.groups.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {part.groups.map((g) => (
              <a
                key={g.id}
                href="/groups"
                className="rounded px-1.5 text-[10px] font-medium"
                style={{ background: g.color ?? "#475569", color: textOn(g.color ?? "#475569") }}
              >
                {g.name}
              </a>
            ))}
          </div>
        )}

        <Row label="Part number">
          <TextField part={part} save={save} field="partNumber" />
        </Row>
        <Row label="Material">
          <MaterialField part={part} save={save} />
        </Row>
        <Row label="Description">
          <TextField part={part} save={save} field="description" />
        </Row>
        <Row label="Quantity Needed">
          <QuantityField part={part} save={save} />
        </Row>
        <Row label="Status">
          <StatusField part={part} save={save} />
        </Row>
        <Row label="Priority">
          <PriorityField part={part} save={save} />
        </Row>
        <Row label="Deadline">
          <DeadlineField part={part} save={save} done={done} />
        </Row>
        <Row label="Drawing">
          {part.drawingUrl && (
            <a href={part.drawingUrl} target="_blank" rel="noreferrer" className="mr-2 text-sky-300 hover:underline">
              Open
            </a>
          )}
          <Popover trigger={<span className="text-slate-400">{part.drawingUrl ? "Change" : "Add link"}</span>}>
            {(close) => (
              <InputEditor
                type="url"
                value={part.drawingUrl ?? ""}
                onCancel={close}
                onSave={(v) => {
                  save({ drawingUrl: v.trim() || null });
                  close();
                }}
              />
            )}
          </Popover>
        </Row>
        <Row label="Files">
          <FilesField part={part} />
        </Row>
        <Row label="Designer">
          <PersonField value={part.designerName} names={memberNames} onSave={(v) => save({ designerName: v })} />
        </Row>

        <div className="pt-1 font-medium text-slate-300">Manufacturing</div>
        {currentSlot && (
          <div className="text-xs text-slate-400 italic">
            Current Process: {getMachine(part[currentSlot.key]!)?.name ?? part[currentSlot.key]}
          </div>
        )}
        {machineSlotsShown(part).map((slot) => {
          const machineId = part[slot.key];
          const machineName = machineId ? (getMachine(machineId)?.name ?? machineId) : null;
          return (
            <div key={slot.key} className="space-y-1 border-l-2 border-slate-700 pl-2 text-xs">
              <div className="flex gap-1">
                <span className="text-slate-400">{slot.label}:</span>
                <MachineField part={part} save={save} slot={slot} placeholder={`Add ${slot.label}`} />
                {machineId && <CadLink part={part} format={getMachine(machineId)?.cadFormat} />}
              </div>
              {machineId && (
                <>
                  <div className="flex items-center gap-1 text-slate-400">
                    {machineName}:
                    <PersonField
                      value={part.fabricators[slot.key] || null}
                      names={memberNames}
                      onSave={(v) => save({ fabricators: { [slot.key]: v ?? "" } })}
                    />
                  </div>
                  <label className="flex items-center gap-2">
                    Done {machineName}:
                    <input
                      type="number"
                      min={0}
                      defaultValue={part[slot.done]}
                      key={part[slot.done]}
                      onBlur={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isInteger(n) && n >= 0 && n !== part[slot.done]) save({ [slot.done]: n });
                      }}
                      className="input w-16 py-0.5"
                    />
                    <span className="text-slate-500">/ {part.quantity}</span>
                  </label>
                </>
              )}
            </div>
          );
        })}

        <div className="pt-1">
          <div className="mb-1 text-xs text-slate-400">Notes</div>
          <textarea
            defaultValue={part.note ?? ""}
            key={part.note ?? ""}
            placeholder="Add a note…"
            rows={2}
            onBlur={(e) => e.target.value.trim() !== (part.note ?? "") && save({ note: e.target.value })}
            className="input"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(["estMinutes", "actualMinutes"] as const).map((field) => (
            <label key={field} className="text-xs text-slate-400">
              {field === "estMinutes" ? "Est. time (min)" : "Actual time (min)"}
              <input
                type="number"
                min={0}
                defaultValue={part[field] ?? ""}
                key={part[field] ?? ""}
                placeholder="—"
                onBlur={(e) => {
                  const v = e.target.value === "" ? null : Number(e.target.value);
                  if (v !== part[field]) save({ [field]: v });
                }}
                className="input mt-1"
              />
            </label>
          ))}
        </div>

        <div className="flex items-center justify-between pt-1 text-[11px] text-slate-500">
          <span>
            Edited {part.lastModifiedAt.toISOString().slice(0, 10)}
            {part.lastModifiedByName && ` by ${part.lastModifiedByName}`}
          </span>
          {part.isManual && (
            <button
              className="text-rose-400 hover:text-rose-200"
              onClick={() => {
                if (confirm(`Delete "${partTitle(part)}"?`)) startTransition(() => void deleteManualPart(part.id));
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5">
      <span className="font-medium text-slate-300">{label}:</span>
      {children}
    </div>
  );
}

// The file the slot's machine needs (ref §4 CAD format): a CAD export, or the drawing link.
function CadLink({ part, format }: { part: CardPart; format?: string }) {
  const cls = "ml-auto text-sky-300 hover:underline";
  if (format === "PDF") {
    return part.drawingUrl ? (
      <a href={part.drawingUrl} target="_blank" rel="noreferrer" className={cls}>
        PDF ↗
      </a>
    ) : null;
  }
  if (part.isManual || !format || !["STEP", "STL", "PARASOLID"].includes(format)) return null;
  return (
    <a href={`/api/parts/${ownerPartId(part)}/export?format=${format}`} className={cls} title="Export from Onshape">
      ⤓ {format === "PARASOLID" ? "x_t" : format}
    </a>
  );
}
