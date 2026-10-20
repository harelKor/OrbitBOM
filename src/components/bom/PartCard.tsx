"use client";

import { useTransition } from "react";
import { getMachine } from "@/config/machines";
import { fabStage } from "@/lib/fab";
import { deleteManualPart, unmergeParts } from "@/app/(app)/parts-actions";
import { useEditMode } from "@/components/shell/ModeContext";
import { CheckBadge } from "@/components/ui/CheckBadge";
import { Icon } from "@/components/ui/Icon";
import { useBom } from "./BomContext";
import { MachineField, MaterialField, NameField, QuantityField, SLOTS, StatusField, TextField, TypeField, type SaveFn } from "./fields";
import { InputEditor, Popover } from "./Popover";
import { ownerPartId, partTitle, type CardPart } from "./types";

const EXPORTABLE = ["STEP", "STL", "PARASOLID"] as const;
type ExportFormat = (typeof EXPORTABLE)[number];

const pill = "rounded-full border border-line-strong bg-raised px-2 py-0.5 text-[11px] font-medium text-fg-2 max-w-full truncate";

// The part card: the Onshape thumbnail is the hero, with quantity and type on its top-left and
// Download / Locate on its top-right; below it the name, the status, a notes button and the
// material → process pills. Properties only open their editors in Edit mode.
export function PartCard({
  part,
  save,
  showSystem = false,
  selected,
  onToggleSelect,
}: {
  part: CardPart;
  save: SaveFn;
  showSystem?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void; // set while a selection mode (Bulk edit, Merge) is on
}) {
  const edit = useEditMode();
  const { robotId } = useBom();
  const machines = SLOTS.filter((s) => part[s.key]);
  // The process being worked on: the first slot whose done counter hasn't reached the quantity.
  const current = machines.find((s) => part[s.done] < Math.max(part.quantity, 1));
  const showCounter = !!current && part.classification !== "cots" && fabStage(part) !== null;
  const format = cadFormat(part);

  return (
    <div data-selected={!!selected} className="card-interactive group flex flex-col text-sm">
      {onToggleSelect && (
        // While selecting, a click anywhere on the card toggles it.
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={selected}
          aria-label={selected ? `Deselect ${partTitle(part)}` : `Select ${partTitle(part)}`}
          className="absolute inset-0 z-20 flex cursor-pointer items-start justify-end p-2"
        >
          <CheckBadge checked={!!selected} />
        </button>
      )}

      <div className="thumb-well relative flex aspect-[4/3] items-center justify-center">
        {part.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
          <img src={part.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain p-3" />
        ) : (
          <span className="text-xs text-muted">{part.isManual ? "Manual part" : "No thumbnail yet"}</span>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1">
          <span className="rounded-full bg-fg/85 px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">
            {edit ? <QuantityField part={part} save={save} /> : `×${part.quantity}`}
          </span>
          {edit ? (
            <span className="rounded bg-white/95 shadow-sm">
              <TypeField part={part} save={save} />
            </span>
          ) : (
            <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-fg-2 shadow-sm">
              {part.classification === "cots" ? "COTS" : "In-house"}
            </span>
          )}
          {part.memberIds && (
            <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-fg-2 shadow-sm" title="Merged parts">
              ⧉ {part.memberIds.length}
            </span>
          )}
        </div>
        <div className="absolute top-2 right-2 flex gap-1.5">
          {format && (
            <a
              href={`/api/parts/${ownerPartId(part)}/export?format=${format}`}
              className="overlay-btn group/tip relative"
              aria-label={`Download ${label(format)}`}
            >
              <Icon name="download" />
              <Tip>{label(format)}</Tip>
            </a>
          )}
          {robotId && !part.isManual && (
            <a href={`/robots/${robotId}?locate=${ownerPartId(part)}#viewer`} className="overlay-btn group/tip relative" aria-label="Locate in robot">
              <Icon name="locate" />
              <Tip>Locate in robot</Tip>
            </a>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 p-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <div className="min-w-0 flex-1 truncate font-semibold text-fg" title={part.displayName ?? part.onshapeName ?? undefined}>
            {edit ? <NameField part={part} save={save} bare /> : (part.displayName ?? part.onshapeName ?? "Unnamed part")}
          </div>
          {(part.partNumber || edit) && (
            <span className="shrink-0 font-mono text-[11px] text-subtle">
              {edit ? <TextField part={part} save={save} field="partNumber" empty="P/N" /> : part.partNumber}
            </span>
          )}
          {edit && <EditMenu part={part} />}
        </div>
        {showSystem && <div className="-mt-1.5 truncate text-xs text-subtle">{part.systemName}</div>}

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <StatusField part={part} save={save} />
          </div>
          <NotesButton part={part} save={save} />
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {(part.material || part.inventoryItemId || edit) && <MaterialField part={part} save={save} className={pill} />}
          {machines.map((slot) => (
            <span key={slot.key} className="contents">
              <span className="text-[10px] text-faint">→</span>
              <MachineField part={part} save={save} slot={slot} className={`${pill} ${slot === current ? "border-accent/60 text-accent" : ""}`} />
            </span>
          ))}
          {edit &&
            SLOTS.filter((s) => !part[s.key] && s.stage === "Process")
              .slice(0, 1)
              .map((slot) => <MachineField key={slot.key} part={part} save={save} slot={slot} placeholder={`+ ${slot.label}`} className={`${pill} border-dashed text-subtle`} />)}
          {showCounter && <DoneCounter part={part} save={save} slot={current!} />}
        </div>
      </div>
    </div>
  );
}

// The CAD file for the part's first machine that takes one, else STEP.
function cadFormat(part: CardPart): ExportFormat | null {
  if (part.isManual) return null;
  for (const slot of SLOTS) {
    const f = part[slot.key] ? getMachine(part[slot.key]!)?.cadFormat : undefined;
    if (f && (EXPORTABLE as readonly string[]).includes(f)) return f as ExportFormat;
  }
  return "STEP";
}

const label = (f: ExportFormat) => (f === "PARASOLID" ? "Parasolid" : f);

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute top-full right-0 mt-1 rounded bg-fg px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white opacity-0 group-hover/tip:opacity-100">
      {children}
    </span>
  );
}

function NotesButton({ part, save }: { part: CardPart; save: SaveFn }) {
  return (
    <Popover
      align="right"
      hideCaret
      triggerClassName="relative h-8 w-8 justify-center rounded-md border border-line-strong text-muted hover:border-accent/50 hover:text-fg"
      trigger={
        <>
          <Icon name="note" />
          <span className="sr-only">{part.note ? "Notes" : "Add a note"}</span>
          {part.note && <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-gold ring-2 ring-white" />}
        </>
      }
    >
      {(close) => (
        <InputEditor
          multiline
          value={part.note ?? ""}
          onCancel={close}
          onSave={(v) => {
            if (v.trim() !== (part.note ?? "")) save({ note: v });
            close();
          }}
        />
      )}
    </Popover>
  );
}

// How many are done at the current machine, with − / + in both modes (it moves the status).
function DoneCounter({ part, save, slot }: { part: CardPart; save: SaveFn; slot: (typeof SLOTS)[number] }) {
  const done = part[slot.done];
  const step = (d: number) => save({ [slot.done]: Math.max(0, done + d) });
  return (
    <span className="ml-auto inline-flex items-center rounded-full border border-line-strong bg-ink text-[11px] tabular-nums">
      <button onClick={() => step(-1)} disabled={done === 0} className="press px-1.5 text-muted hover:text-fg disabled:opacity-30" aria-label="One less done">
        −
      </button>
      <span className="font-semibold text-fg" title={`Done at ${getMachine(part[slot.key]!)?.name}`}>
        {done}/{part.quantity}
      </span>
      <button onClick={() => step(1)} className="press px-1.5 text-muted hover:text-fg" aria-label="One more done">
        +
      </button>
    </span>
  );
}

function EditMenu({ part }: { part: CardPart }) {
  const [, startTransition] = useTransition();
  if (!part.memberIds && !part.isManual) return null;
  return (
    <Popover align="right" hideCaret triggerClassName="rounded p-0.5 text-subtle hover:text-fg" trigger={<Icon name="more" />}>
      {(close) => (
        <div className="space-y-0.5 text-sm">
          {part.memberIds && (
            <button
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-raised"
              onClick={() => {
                close();
                startTransition(() => void unmergeParts(part.id));
              }}
            >
              Unmerge
            </button>
          )}
          {part.isManual && (
            <button
              className="block w-full rounded px-2 py-1.5 text-left text-rose-700 hover:bg-raised"
              onClick={() => {
                close();
                if (confirm(`Delete "${partTitle(part)}"?`)) startTransition(() => void deleteManualPart(part.id));
              }}
            >
              Delete part
            </button>
          )}
        </div>
      )}
    </Popover>
  );
}
