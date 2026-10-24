"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { getMachine } from "@/config/machines";
import { IN_PROCESS_STATUS, READY_STATUS, fabStage, isFabFinished } from "@/lib/fab";
import { deleteManualPart, unmergeParts } from "@/app/(app)/parts-actions";
import { useEditMode } from "@/components/shell/ModeContext";
import { PartStage, type StageView } from "@/components/dashboard/PartStage";
import { computeStatus, partStatusLabel } from "@/lib/status";
import { statusTint } from "@/components/ui/statusTint";
import { CheckBadge, CheckIcon } from "@/components/ui/CheckBadge";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
import { VersionTag } from "@/components/versions/VersionTag";
import { useBom } from "./BomContext";
import { PART_FILE_TYPES } from "@/config/fileTypes";
import { MachineField, MaterialField, NameField, QuantityField, SLOTS, StatusField, TypeBadge, TypeField, type SaveFn } from "./fields";
import { InputEditor, Popover } from "./Popover";
import { ownerPartId, partIds, partTitle, type CardPart } from "./types";
import { downloadDrawing } from "@/lib/drawing/download";
import { DrawingEditor } from "@/components/drawing/DrawingEditor";
import { DrawingPreview } from "@/components/drawing/DrawingPreview";
import { PartDetails } from "./PartDetails";
import { CotsCard } from "@/components/cots/CotsCard";

const EXPORTABLE = ["STEP", "STL", "PARASOLID"] as const;
const FLAT = ["DXF_FLAT", "STEP_FLAT"] as const; // only for Onshape sheet metal parts
type ExportFormat = (typeof EXPORTABLE)[number] | (typeof FLAT)[number];

const pill = "rounded-full border border-line-strong bg-raised px-2 py-0.5 text-[11px] font-medium text-fg-2 max-w-full truncate";

// A click on a card's body opens the part's details, unless it lands on one of its controls.
export const isCardBodyClick = (e: React.MouseEvent) => !(e.target as HTMLElement).closest("a, button, input, select, textarea, label, [role=dialog], dialog");

// The part card: the Onshape thumbnail is the hero (click it for the part's 3D preview, where
// Locate in robot lives), with quantity, type and the Merged tag on its top-left and Download on
// its top-right; below it two dense rows: the name with the drawing and notes buttons, then the
// status and the material → process pills. Properties only open their editors in Edit mode, and a
// click anywhere else below the thumbnail opens the part's details window. On To Fab the rows are
// read-only: status, amount, material, machine and Open drawing. COTS parts get their own card
// (CotsCard): bought, not made.
export function PartCard(props: React.ComponentProps<typeof MadePartCard>) {
  return props.part.classification === "cots" ? <CotsCard {...props} /> : <MadePartCard {...props} />;
}

function MadePartCard({
  part,
  save,
  showSystem = false,
  selected,
  onToggleSelect,
  fabCounter = false,
  style,
  onCheck,
  checked = false,
}: {
  part: CardPart;
  save: SaveFn;
  showSystem?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void; // set while a selection mode (Bulk edit, Merge) is on
  fabCounter?: boolean; // To Fab: − / + on the thumbnail's bottom corners count parts made
  style?: React.CSSProperties;
  onCheck?: () => void; // Ready for QA: a big check mark replaces Download and moves the part to In Stock
  checked?: boolean; // Ready for QA: checked off this visit (struck through; a second click undoes it)
}) {
  const edit = useEditMode();
  const { robotId, versions } = useBom();
  const machines = SLOTS.filter((s) => part[s.key]);
  // The process being worked on: the first slot whose done counter hasn't reached the quantity.
  const current = machines.find((s) => part[s.done] < Math.max(part.quantity, 1));
  const showCounter = !!current && part.classification !== "cots" && fabStage(part) !== null;
  // On To Fab, + counts one more and − takes back the last one counted. When − would leave nothing
  // counted, the part goes back to In process if it was finished, else to Released.
  const counted = machines.slice(0, current ? machines.indexOf(current) + 1 : machines.length).reverse().find((s) => part[s.done] > 0);
  const finished = isFabFinished(part);
  const takeBack = () => {
    const left = part.donePreprocess + part.doneProcess1 + part.doneProcess2 - 1;
    if (counted && left > 0) save({ [counted.done]: part[counted.done] - 1 });
    else save({ status: finished ? IN_PROCESS_STATUS : READY_STATUS });
  };
  const fabControls = fabCounter && part.classification !== "cots" && machines.length > 0;
  const format = cadFormat(part);
  const [stage, setStage] = useState<StageView | null>(null);
  const [details, setDetails] = useState(false);
  const openDetails = (e: React.MouseEvent) => isCardBodyClick(e) && setDetails(true);
  const onshapeMaterial = part.geometry?.onshapeMaterial ?? null;

  return (
    <div id={`part-${part.id}`} data-selected={!!selected} data-part={partIds(part)} style={style ?? statusTint(computeStatus(part))} className={`card-interactive group flex scroll-mt-20 flex-col text-sm target:border-accent target:ring-2 target:ring-accent ${checked ? "opacity-60" : ""}`}>
      {checked && <span aria-hidden className="pointer-events-none absolute inset-x-3 top-1/2 z-10 h-0.5 -rotate-6 rounded-full bg-emerald-500" />}
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

      <div className="thumb-well thumb-made relative flex aspect-[4/3] items-center justify-center">
        {part.isManual ? (
          <span className="text-xs text-muted">Manual part</span>
        ) : (
          <button type="button" onClick={() => setStage("part")} className="flex h-full w-full cursor-zoom-in items-center justify-center" aria-label={`3D preview of ${partTitle(part)}`}>
            {part.thumbUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
              <img src={part.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain p-3" />
            ) : (
              <span className="text-xs text-muted">No thumbnail yet, click for 3D</span>
            )}
          </button>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1">
          {!fabCounter && (
            <span className="rounded-full bg-[#111318]/85 px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">
              {edit ? <QuantityField part={part} save={save} /> : `×${part.quantity}`}
            </span>
          )}
          {!fabCounter && (edit ? <TypeField part={part} save={save} badge /> : <TypeBadge part={part} />)}
          <MergedBadge part={part} />
        </div>
        <div className="absolute top-2 right-2 flex gap-1.5">
          {onCheck ? (
            <button
              type="button"
              onClick={onCheck}
              aria-pressed={checked}
              className={`press flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-lg backdrop-blur-md ${
                checked ? "border-emerald-400 bg-surface/90 text-emerald-500 hover:bg-raised" : "border-emerald-400 bg-emerald-500/90 text-white hover:bg-emerald-400"
              }`}
              aria-label={checked ? `Undo: put ${partTitle(part)} back in Ready for QA` : `Checked: move ${partTitle(part)} to In Stock`}
              title={checked ? "Undo: back to Ready for QA" : "Checked: move to In Stock"}
            >
              <CheckIcon className="h-8 w-8" />
            </button>
          ) : (
            (format || part.files.length > 0 || part.hasDrawing) && <DownloadMenu part={part} format={format} />
          )}
        </div>
        {part.note && <NoteCloud note={part.note} raised={fabControls} />}
        {versions && !part.isManual && !fabControls && (
          <div className="absolute right-2 bottom-2">
            <VersionTag partId={part.id} tags={versions} />
          </div>
        )}
        {fabControls && (
          <>
            <button
              type="button"
              onClick={takeBack}
              disabled={!counted && !finished}
              className="overlay-btn absolute bottom-2 left-2 text-lg font-bold disabled:opacity-30"
              aria-label="One less made"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => current && save({ [current.done]: part[current.done] + 1 })}
              disabled={!current}
              className="overlay-btn absolute right-2 bottom-2 text-lg font-bold disabled:opacity-30"
              aria-label="One more made"
            >
              +
            </button>
          </>
        )}
      </div>
      {stage && (
        <PartStage
          partId={ownerPartId(part)}
          robotId={robotId ?? null}
          modelKey={part.modelKey}
          name={partTitle(part)}
          material={part.material}
          onshapeMaterial={onshapeMaterial}
          view={stage}
          onView={setStage}
          onClose={() => setStage(null)}
        />
      )}

      {details && <PartDetails part={part} save={save} onClose={() => setDetails(false)} />}

      {fabCounter ? (
        <FabFooter part={part} current={current ?? machines.at(-1)} onClick={openDetails} />
      ) : (
        <div className="flex min-w-0 cursor-pointer flex-col gap-1.5 px-2.5 py-2" onClick={openDetails}>
          <div className="flex min-w-0 items-center gap-1">
            <div className={`min-w-0 flex-1 truncate text-[13px] font-semibold text-fg ${checked ? "line-through" : ""}`} title={part.displayName ?? part.onshapeName ?? undefined}>
              {edit ? <NameField part={part} save={save} bare /> : (part.displayName ?? part.onshapeName ?? "Unnamed part")}
              {showSystem && <span className="ml-1.5 text-[11px] font-normal text-subtle">{part.systemName}</span>}
            </div>
            {showCounter && <DoneCounter part={part} save={save} slot={current!} />}
            {!part.isManual && <DrawingButton partId={ownerPartId(part)} hasDrawing={!!part.hasDrawing} />}
            <NotesButton part={part} save={save} />
            {edit && <EditMenu part={part} />}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <StatusField part={part} save={save} size="sm" />
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
          </div>
        </div>
      )}
    </div>
  );
}

// To Fab's read-only rows: the status and how many are made of the amount, then the material,
// the machine it's at and Open drawing (the drawing in a big window).
function FabFooter({ part, current, onClick }: { part: CardPart; current: (typeof SLOTS)[number] | undefined; onClick: (e: React.MouseEvent) => void }) {
  const { inventory } = useBom();
  const [drawing, setDrawing] = useState(false);
  const linked = part.inventoryItemId ? inventory.find((i) => i.id === part.inventoryItemId) : undefined;
  const material = linked?.name ?? part.material;
  const machine = current ? (getMachine(part[current.key]!)?.name ?? part[current.key]) : null;
  const made = current ? part[current.done] : part.quantity;
  return (
    <div className="flex min-w-0 cursor-pointer flex-col gap-1.5 px-2.5 py-2" onClick={onClick}>
      <div className="flex min-w-0 items-center gap-1.5">
        <StatusPill status={computeStatus(part)} label={partStatusLabel(part)} />
        <span className="ml-auto font-mono text-xs font-semibold text-fg tabular-nums" title={machine ? `Made at ${machine} of the amount` : "Amount"}>
          {made}/{part.quantity}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <span className={`${pill} min-w-0`} title="Material">
          {material ?? "No material"}
        </span>
        {machine && (
          <span className={`${pill} min-w-0 border-accent/60 text-accent`} title="Machine">
            {machine}
          </span>
        )}
        <button
          type="button"
          onClick={() => setDrawing(true)}
          disabled={!part.hasDrawing}
          title={part.hasDrawing ? "Open the drawing" : "No drawing yet"}
          className="press ml-auto flex h-7 shrink-0 items-center gap-1 rounded-md border border-line-strong px-2 text-[11px] font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:opacity-40"
        >
          <Icon name="drawing" className="h-3.5 w-3.5" />
          Open drawing
        </button>
      </div>
      {drawing && <DrawingPreview partId={ownerPartId(part)} title={partTitle(part)} onClose={() => setDrawing(false)} />}
    </div>
  );
}

// The CAD file for the part's first machine that takes one (a sheet metal part's flat pattern
// for a cutting machine), else STEP.
export function cadFormat(part: CardPart): ExportFormat | null {
  if (part.isManual) return null;
  for (const slot of SLOTS) {
    const machine = part[slot.key] ? getMachine(part[slot.key]!) : undefined;
    if (machine?.sheetFormat && part.geometry?.sheetMetal) return machine.sheetFormat;
    const f = machine?.cadFormat;
    if (f && (EXPORTABLE as readonly string[]).includes(f)) return f as ExportFormat;
  }
  return "STEP";
}

const LABELS: Partial<Record<ExportFormat, string>> = { PARASOLID: "Parasolid", DXF_FLAT: "Flat DXF", STEP_FLAT: "Flat STEP" };
export const label = (f: ExportFormat) => LABELS[f] ?? f;

// Every way to download the part: the CAD exports (the first machine's format on top) and any
// files attached to it.
export function DownloadMenu({ part, format }: { part: CardPart; format: ExportFormat | null }) {
  const all: ExportFormat[] = part.geometry?.sheetMetal ? [...FLAT, ...EXPORTABLE] : [...EXPORTABLE];
  const exports = format ? [format, ...all.filter((f) => f !== format)] : [];
  const item = "flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-raised";
  return (
    <Popover align="right" hideCaret triggerClassName="overlay-btn" trigger={<><Icon name="download" /><span className="sr-only">Download</span></>}>
      {(close) => (
        <div className="space-y-0.5 text-sm">
          {exports.length > 0 && <div className="px-2 pb-1 text-[11px] font-semibold text-subtle">CAD from Onshape</div>}
          {exports.map((f, i) => (
            <a key={f} href={`/api/parts/${ownerPartId(part)}/export?format=${f}`} onClick={close} className={item}>
              <span className="font-medium text-fg">{label(f)}</span>
              {i === 0 && <span className="text-[11px] text-subtle">for its machine</span>}
            </a>
          ))}
          {part.hasDrawing && <div className="px-2 pt-2 pb-1 text-[11px] font-semibold text-subtle">Drawing</div>}
          {part.hasDrawing &&
            (["pdf", "png"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  close();
                  downloadDrawing(ownerPartId(part), f).catch((err: Error) => alert(err.message));
                }}
                className={`${item} w-full text-left`}
              >
                <span className="font-medium text-fg">{f.toUpperCase()}</span>
              </button>
            ))}
          {part.files.length > 0 && <div className="px-2 pt-2 pb-1 text-[11px] font-semibold text-subtle">Attached files</div>}
          {part.files.map((file) => (
            <a key={file.id} href={`/api/files/${file.id}?download=1`} onClick={close} className={item}>
              <span className="min-w-0 truncate text-fg" title={file.filename}>
                {file.filename}
              </span>
              <span className="shrink-0 text-[11px] text-subtle">{PART_FILE_TYPES.find((t) => t.id === file.type)?.label ?? file.type}</span>
            </a>
          ))}
        </div>
      )}
    </Popover>
  );
}

// The part's note as a comic-book thought cloud over the thumbnail, in bold on yellow so it is hard
// to miss; the notes button edits it.
export function NoteCloud({ note, raised = false }: { note: string; raised?: boolean }) {
  return (
    <div className={`pointer-events-none absolute left-3 max-w-[80%] ${raised ? "bottom-14" : "bottom-4"}`}>
      <div className="relative rounded-[1.6rem] border-[3px] border-[#111318] bg-[#fff59d] px-3.5 py-2 text-sm leading-snug font-bold text-[#111318] shadow-[3px_4px_0_0_rgba(17,19,24,0.9)]">
        <span className="line-clamp-4 break-words whitespace-pre-line">{note}</span>
      </div>
      {/* The cloud's trailing puffs. */}
      <span className="absolute -bottom-2.5 left-5 h-3 w-3 rounded-full border-[3px] border-[#111318] bg-[#fff59d]" />
      <span className="absolute -bottom-4 left-2 h-2 w-2 rounded-full border-2 border-[#111318] bg-[#fff59d]" />
    </div>
  );
}

// Opens the part's drawing in the drawing editor, making it from Onshape first when it has none.
function DrawingButton({ partId, hasDrawing }: { partId: string; hasDrawing: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [making, setMaking] = useState(false);
  async function onClick() {
    if (hasDrawing) return setOpen(true);
    setMaking(true);
    const res = await fetch(`/api/parts/${partId}/drawing`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    setMaking(false);
    if (!res.ok) return alert((await res.json().catch(() => ({}))).error ?? "Couldn't make the drawing.");
    router.refresh();
    setOpen(true);
  }
  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={making}
        className={`press flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line-strong hover:border-accent/50 hover:text-fg ${hasDrawing ? "text-muted" : "border-dashed text-subtle"} ${making ? "animate-pulse" : ""}`}
        aria-label={hasDrawing ? "Drawing" : "Make drawing"}
        title={making ? "Making the drawing…" : hasDrawing ? "Drawing" : "Make drawing"}
      >
        <Icon name="drawing" />
      </button>
      {open && <DrawingEditor partId={partId} onClose={() => setOpen(false)} />}
    </>
  );
}

export function NotesButton({ part, save }: { part: CardPart; save: SaveFn }) {
  return (
    <Popover
      align="right"
      hideCaret
      triggerClassName="relative h-7 w-7 shrink-0 justify-center rounded-md border border-line-strong text-muted hover:border-accent/50 hover:text-fg"
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
export function DoneCounter({ part, save, slot }: { part: CardPart; save: SaveFn; slot: (typeof SLOTS)[number] }) {
  const done = part[slot.done];
  const step = (d: number) => save({ [slot.done]: Math.max(0, done + d) });
  return (
    <span className="ml-auto inline-flex shrink-0 items-center rounded-full border border-line-strong bg-ink text-[11px] tabular-nums">
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

// The Merged tag: how many BOM rows the card stands for; a click offers Unmerge.
export function MergedBadge({ part }: { part: CardPart }) {
  const [pending, startTransition] = useTransition();
  if (!part.memberIds) return null;
  const n = part.memberIds.length;
  return (
    <Popover
      hideCaret
      triggerClassName="rounded-full border border-accent/40 bg-surface/95 px-2 py-0.5 text-[11px] leading-none font-bold text-accent shadow-sm hover:border-accent"
      trigger={
        <span className="py-0.5 tabular-nums" title={`${n} parts merged into one row`}>
          ⧉ Merged · {n}
        </span>
      }
    >
      {(close) => (
        <div className="space-y-2 p-1 text-sm">
          <p className="text-fg-2">
            <span className="font-semibold text-fg tabular-nums">{n} parts</span> are shown as this one row. Unmerging puts each back on its own card, with its own status and counts.
          </p>
          <button
            type="button"
            disabled={pending}
            className="btn w-full justify-center"
            onClick={() =>
              startTransition(async () => {
                await unmergeParts(part.id);
                close();
              })
            }
          >
            {pending ? "Unmerging…" : "Unmerge"}
          </button>
        </div>
      )}
    </Popover>
  );
}

export function EditMenu({ part }: { part: CardPart }) {
  const [, startTransition] = useTransition();
  if (!part.isManual) return null;
  return (
    <Popover align="right" hideCaret triggerClassName="rounded p-0.5 text-subtle hover:text-fg" trigger={<Icon name="more" />}>
      {(close) => (
        <div className="space-y-0.5 text-sm">
          <button
            className="block w-full rounded px-2 py-1.5 text-left text-rose-700 hover:bg-raised"
            onClick={() => {
              close();
              if (confirm(`Delete "${partTitle(part)}"?`)) startTransition(() => void deleteManualPart(part.id));
            }}
          >
            Delete part
          </button>
        </div>
      )}
    </Popover>
  );
}
