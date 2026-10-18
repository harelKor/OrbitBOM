"use client";

import { useState, useTransition } from "react";
import { getMachine } from "@/config/machines";
import { getStatus } from "@/config/statuses";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { computeStatus, isDone } from "@/lib/status";
import { deleteManualPart, updatePart } from "@/app/(app)/parts-actions";
import {
  MATERIAL_OPTIONS,
  PRIORITY_COLORS,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  TYPE_LABELS,
  TYPE_OPTIONS,
  machineOptions,
  textOn,
} from "./options";
import { InputEditor, OptionList, Popover } from "./Popover";
import { partTitle, type CardPart } from "./types";

const SLOTS = [
  { key: "preProcess", done: "donePreprocess", label: "Pre Process", stage: "PreProcess" },
  { key: "process1", done: "doneProcess1", label: "Process 1", stage: "Process" },
  { key: "process2", done: "doneProcess2", label: "Process 2", stage: "Process" },
] as const;

export function PartCard({
  part: initial,
  memberNames,
  showSystem = false,
}: {
  part: CardPart;
  memberNames: string[];
  showSystem?: boolean;
}) {
  const [part, setPart] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Take fresh server data when it changes (after a save or someone else's edit).
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setPart(initial);
  }

  function save(changes: PartChanges) {
    const before = part;
    setPart({ ...part, ...planPartUpdate(part, changes, "ui").set });
    setError(null);
    startTransition(async () => {
      const result = await updatePart(part.id, changes);
      if (result.error) {
        setPart(before);
        setError(result.error);
      }
    });
  }

  const status = computeStatus(part);
  const statusDef = getStatus(status);
  const done = isDone(part);
  const currentSlot = SLOTS.find((s) => part[s.key] && part[s.done] < Math.max(part.quantity, 1));

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border text-sm ${
        done ? "border-emerald-800 bg-emerald-950/40" : "border-slate-800 bg-slate-900"
      }`}
    >
      <div className="flex h-28 items-center justify-center bg-slate-800/50 text-xs text-slate-600">
        {part.isManual ? "Manual part" : "No thumbnail yet"}
      </div>
      <div className="space-y-1.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <Popover
            trigger={<span className="font-semibold text-indigo-300">{partTitle(part)}</span>}
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
          <Popover
            align="right"
            trigger={
              <span className="rounded border border-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
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
        </div>
        {part.onshapeName && part.displayName && part.displayName !== part.onshapeName && (
          <div className="text-xs text-slate-500">Onshape: {part.onshapeName}</div>
        )}
        {showSystem && <div className="text-xs text-slate-500">{part.systemName}</div>}

        <Row label="Part number">
          <Popover trigger={part.partNumber ?? <Empty />}>
            {(close) => (
              <InputEditor
                value={part.partNumber ?? ""}
                onCancel={close}
                onSave={(v) => {
                  save({ partNumber: v });
                  close();
                }}
              />
            )}
          </Popover>
        </Row>

        <Row label="Material">
          <Popover trigger={part.material ?? <Empty />}>
            {(close) => (
              <OptionList
                options={MATERIAL_OPTIONS}
                value={part.material}
                onPick={(v) => {
                  save({ material: v });
                  close();
                }}
              />
            )}
          </Popover>
        </Row>

        <Row label="Description">
          <Popover trigger={part.description ?? <Empty />}>
            {(close) => (
              <InputEditor
                value={part.description ?? ""}
                onCancel={close}
                onSave={(v) => {
                  save({ description: v });
                  close();
                }}
              />
            )}
          </Popover>
        </Row>

        <Row label="Quantity Needed">
          <Popover trigger={part.quantity}>
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
        </Row>

        <Row label="Status">
          <Popover
            trigger={
              <span
                className="rounded px-1.5 py-0.5 text-xs font-medium"
                style={{ background: statusDef?.color ?? "#cbd5e1", color: textOn(statusDef?.color ?? "#cbd5e1") }}
              >
                {status}
              </span>
            }
          >
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
        </Row>

        <Row label="Priority">
          <Popover
            trigger={
              <span
                className="rounded px-1.5 py-0.5 text-xs font-medium text-white"
                style={{ background: PRIORITY_COLORS[part.priority] }}
              >
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
        </Row>

        <Row label="Deadline">
          <Popover trigger={part.deadline ? <Deadline date={part.deadline} done={done} /> : <Empty text="Set a date" />}>
            {(close) => (
              <InputEditor
                type="date"
                value={part.deadline ?? ""}
                onCancel={close}
                onSave={(v) => {
                  save({ deadline: v || null });
                  close();
                }}
              />
            )}
          </Popover>
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
                  save({ drawingUrl: v || null });
                  close();
                }}
              />
            )}
          </Popover>
        </Row>

        <Row label="Designer">
          <PersonPicker
            value={part.designerName}
            names={memberNames}
            onSave={(v) => save({ designerName: v })}
          />
        </Row>

        <div className="pt-1 font-medium text-slate-300">Manufacturing</div>
        {currentSlot && (
          <div className="text-xs text-slate-400 italic">
            Current Process: {getMachine(part[currentSlot.key]!)?.name ?? part[currentSlot.key]}
          </div>
        )}
        {SLOTS.map((slot) => {
          const machineId = part[slot.key];
          const options = machineOptions(slot.stage);
          if (!machineId && options.length <= 1) return null;
          const machineName = machineId ? (getMachine(machineId)?.name ?? machineId) : null;
          return (
            <div key={slot.key} className="space-y-1 border-l-2 border-slate-700 pl-2">
              <Popover trigger={machineName ? <span className="text-xs">{slot.label}: {machineName}</span> : <span className="text-xs text-slate-500">— Add {slot.label} —</span>}>
                {(close) => (
                  <OptionList
                    options={options}
                    value={machineId}
                    onPick={(v) => {
                      save({ [slot.key]: v });
                      close();
                    }}
                  />
                )}
              </Popover>
              {machineId && (
                <>
                  <div className="flex items-center gap-1 text-xs text-slate-400">
                    {machineName}:
                    <PersonPicker
                      value={part.fabricators[slot.key] || null}
                      names={memberNames}
                      onSave={(v) => save({ fabricators: { [slot.key]: v ?? "" } })}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs">
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

        {error && <p className="text-xs text-rose-300">{error}</p>}
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

function Empty({ text = "—" }: { text?: string }) {
  return <span className="text-slate-500">{text}</span>;
}

function Deadline({ date, done }: { date: string; done: boolean }) {
  const [now] = useState(() => Date.now());
  const days = Math.ceil((new Date(date).getTime() - now) / 86_400_000);
  const color = done ? "text-slate-300" : days < 0 ? "text-rose-400" : days <= 7 ? "text-amber-300" : "text-slate-300";
  return <span className={color}>{date}</span>;
}

function PersonPicker({
  value,
  names,
  onSave,
}: {
  value: string | null;
  names: string[];
  onSave: (value: string | null) => void;
}) {
  return (
    <Popover trigger={value ?? <span className="text-slate-500 italic">Unassigned</span>}>
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
