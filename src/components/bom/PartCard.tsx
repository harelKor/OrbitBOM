"use client";

import { toast } from "@/components/ui/Toaster";
import { askConfirm } from "@/components/ui/useConfirm";
import { useState, useTransition } from "react";
import { getMachine } from "@/config/machines";
import { fabCounts, fabStage } from "@/lib/fab";
import { deleteManualPart, unmergeParts } from "@/app/(app)/parts-actions";
import { useCan, usePermissions } from "@/components/shell/ModeContext";
import { computeStatus, partStatusLabel } from "@/lib/status";
import { statusTint } from "@/components/ui/statusTint";
import { CheckBadge, CheckIcon } from "@/components/ui/CheckBadge";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
import { VersionTag } from "@/components/versions/VersionTag";
import { useBom } from "./BomContext";
import { PART_FILE_TYPES } from "@/config/fileTypes";
import { MachineField, MaterialField, NameField, QuantityField, SLOTS, StatusField, TypeBadge, TypeField, type SaveFn } from "./fields";
import { Popover } from "./Popover";
import { ownerPartId, partIds, partTitle, type CardPart } from "./types";
import { downloadDrawing } from "@/lib/drawing/download";
import { DrawingPreview } from "@/components/drawing/DrawingPreview";
import { usePartDetails } from "./PartDetailsHost";
import { CotsCard } from "@/components/cots/CotsCard";
import { NoteCloud } from "./NoteCloud";
import { downloadExport } from "./downloadExport";
import { LinkTag } from "@/components/cots/ShelfPill";
import { CardSuggest } from "./CardSuggest";

export { NoteCloud };

const EXPORTABLE = ["STEP", "STL", "PARASOLID", "DXF"] as const; // DXF: a plate laid flat, made in the app
const FLAT = ["DXF_FLAT", "STEP_FLAT"] as const; // only for Onshape sheet metal parts
type ExportFormat = (typeof EXPORTABLE)[number] | (typeof FLAT)[number];

const pill = "rounded-full border border-line-strong bg-raised px-2 py-0.5 text-[0.6875rem] font-medium text-fg-2 max-w-full truncate";

// A click on a card's body opens the part's details, unless it lands on one of its controls.
// A control or a window inside the card (or portalled from it) takes its own clicks; a window the
// card itself sits in (the dashboard's Post Process) doesn't, so its cards still open.
export const isCardBodyClick = (e: React.MouseEvent) => {
  const hit = (e.target as HTMLElement).closest("a, button, input, select, textarea, label, [role=dialog], dialog");
  return !hit || hit.contains(e.currentTarget as Node);
};

// The part card: the Onshape thumbnail is the hero, with quantity, type and the Merged tag on its
// top-left, Download on its top-right (the linked inventory item opens from the details window and
// the List view's row) and
// the version tag on its bottom-right, with Suggest (then ✓ / ✕) beside it on Undefined parts; below it two dense rows: the name, then
// the status and the material → process pills. Properties only open their editors in Edit mode,
// and a click anywhere else on the card opens the part's details window (3D, notes, drawing,
// inventory). On To Fab the rows are read-only (status, amount, material, machine) and the
// drawing icon sits on the thumbnail's top-left. COTS parts get their own card (CotsCard): bought, not made.
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
  checkFrom = "Ready for QA",
  checkTo = "In Stock",
  fabStatusEditable = false,
  post,
  thumbBadge,
  statusButton,
  nameNote,
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
  checkFrom?: string; // the status the check takes the part from (To Post Process: Post Processing)
  checkTo?: string; // and the one it moves it to (To Post Process: Ready for QA)
  fabStatusEditable?: boolean; // To Fab, inside a batch: the part's own status can be changed
  // To Post Process: how many are post-processed, with − / + along the thumbnail's bottom; the card
  // drops the type, amount, material and machines.
  post?: { done: number; onChange: (n: number) => void };
  thumbBadge?: React.ReactNode; // To Fab, inside a batch: a control at the very start of the thumbnail's top-left
  statusButton?: React.ReactNode; // Factory Fab: the name, then only this big status button
  nameNote?: string; // Factory Fab (Zivudim): the material, beside the name
}) {
  // Edit: name, type and the manual part menu. Work (any team): status, amount, material, counters.
  const { canManage: edit, canWork: work, canClassify } = usePermissions();
  const { versions } = useBom();
  const { machines, current, counted, finished, made, takeBack, addOne } = fabSteps(part, save);
  const showCounter = !!current && part.classification !== "cots" && fabStage(part) !== null;
  const fabControls = fabCounter && work && part.classification !== "cots" && machines.length > 0;
  const format = cadFormat(part);
  const showDetails = usePartDetails(part, save);
  const openDetails = (e: React.MouseEvent) => {
    if (!onToggleSelect && isCardBodyClick(e)) showDetails();
  };
  const [drawing, setDrawing] = useState(false);
  const download = !!(format || part.files.length > 0 || part.hasDrawing);
  // On a narrow card Download sits on the thumbnail's bottom-right, unless − / + use that corner.
  const bottomDownload = download && !onCheck && !fabControls && !post;
  // A drawing file (uploaded in the details window, or synced from an Onshape drawing tab).
  const drawingFile = part.files.find((f) => f.type === "drawing");
  // The BOM's own cards (not To Fab, To Post Process or Ready for QA) offer Suggest on Undefined parts.
  const suggestable = !onCheck && !fabCounter && !post && !onToggleSelect;
  // Ready for QA (the check without Post Processing's counts): the drawing to check against and
  // only the machines, no material (Harel, 2026-11-08).
  const qa = !!onCheck && !post;

  return (
    <div id={`part-${part.id}`} data-selected={!!selected} data-part={partIds(part)} style={style ?? statusTint(computeStatus(part))} onClick={openDetails} className={`card-interactive part-card group flex w-full max-w-full min-w-0 overflow-hidden scroll-mt-20 cursor-pointer flex-col text-sm target:border-accent target:ring-2 target:ring-accent ${checked ? "opacity-60" : ""}`}>
      {checked && !post && <span aria-hidden className="pointer-events-none absolute inset-x-3 top-1/2 z-10 h-0.5 -rotate-6 rounded-full bg-emerald-500" />}
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
        ) : part.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
          <img src={part.thumbUrl} alt="" loading="lazy" className="thumb-edge h-full w-full object-contain p-3" />
        ) : (
          <span className="text-xs text-muted">No thumbnail yet</span>
        )}
        {post && checked && (
          // Checked off: a red line from the bottom-left corner to the top-right.
          <svg aria-hidden className="pointer-events-none absolute inset-0 z-10 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
            <line x1="4" y1="96" x2="96" y2="4" stroke="#dc2626" strokeWidth="4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
        <div className="absolute top-2 left-2 flex items-center gap-1">
          {thumbBadge}
          {(fabCounter || post || qa) && (part.hasDrawing || drawingFile) && (
            <button
              type="button"
              onClick={() => setDrawing(true)}
              className="overlay-btn"
              aria-label="View drawing"
              title="View drawing"
            >
              <Icon name="drawing" />
            </button>
          )}
          {!fabCounter && !post && (
            <span className="rounded-full bg-[#111318]/85 px-2 py-0.5 text-[0.6875rem] font-bold text-white tabular-nums">
              {work ? <QuantityField part={part} save={save} /> : `×${part.quantity}`}
            </span>
          )}
          {!fabCounter && !post && (canClassify ? <TypeField part={part} save={save} badge /> : <TypeBadge part={part} />)}
          <MergedBadge part={part} />
        </div>
        <div className="absolute top-2 right-2 flex max-w-[60%] items-start gap-1.5">
          {!onCheck && !fabCounter && !post && <LinkTag part={part} save={save} />}
          {onCheck && work ? (
            <button
              type="button"
              onClick={onCheck}
              aria-pressed={checked}
              className={`press flex h-14 w-14 items-center justify-center rounded-full border-2 shadow-lg backdrop-blur-md ${
                checked ? "border-emerald-400 bg-surface/90 text-emerald-500 hover:bg-raised" : "border-emerald-400 bg-emerald-500/90 text-white hover:bg-emerald-400"
              }`}
              aria-label={checked ? `Undo: put ${partTitle(part)} back in ${checkFrom}` : `Checked: move ${partTitle(part)} to ${checkTo}`}
              title={checked ? `Undo: back to ${checkFrom}` : `Checked: move to ${checkTo}`}
            >
              <CheckIcon className="h-8 w-8" />
            </button>
          ) : (
            <>
              {download && <span className={bottomDownload ? "dl-wide" : "contents"}><DownloadMenu part={part} format={format} /></span>}
            </>
          )}
        </div>
        {part.note && <NoteCloud note={part.note} raised={fabControls || !!post} />}
        {post && work && (
          <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2">
            <button type="button" onClick={() => post.onChange(post.done - 1)} disabled={post.done === 0} className="overlay-btn text-lg font-bold disabled:opacity-30" aria-label="One less post-processed">
              −
            </button>
            <span className="rounded-full bg-[#111318]/85 px-2.5 py-1 font-mono text-xs font-bold text-white tabular-nums" title="Post-processed of the amount">
              {post.done}/{part.quantity}
            </span>
            <button
              type="button"
              onClick={() => post.onChange(post.done + 1)}
              disabled={post.done >= part.quantity}
              className="overlay-btn text-lg font-bold disabled:opacity-30"
              aria-label="One more post-processed"
            >
              +
            </button>
          </div>
        )}
        {!fabControls && !post && (versions || bottomDownload || suggestable) && (
          // Narrow cards: Download moves here from the top-right (globals.css .dl-narrow), beside the version tag.
          // Undefined parts get Suggest here, which turns into ✓ / ✕ once it suggested something.
          <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
            {suggestable && <CardSuggest part={part} />}
            {versions && <VersionTag partId={part.id} tags={versions} manual={part.isManual} />}
            {bottomDownload && <span className="dl-narrow"><DownloadMenu part={part} format={format} /></span>}
          </div>
        )}
        {part.fabView?.changed && (
          // To Fab only: the BOM moved past the state this part was released at. Above Post
          // Processing's done count, which sits in the same bottom middle.
          <div className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center ${post && work ? "bottom-12" : "bottom-2"}`}>
            <span
              className="rounded-full bg-red-600 px-2.5 py-0.5 text-[0.6875rem] font-bold tracking-wide text-white uppercase shadow-[0_0_10px_2px_rgba(220,38,38,0.45)]"
              title={`Changed in the BOM since it was released${part.fabLock?.label ? ` at ${part.fabLock.label}` : ""}. Shop Fab still shows the released version.`}
            >
              Changed
            </span>
          </div>
        )}
        {drawing && (
          <DrawingPreview
            partId={ownerPartId(part)}
            systemId={part.systemId}
            title={partTitle(part)}
            hasDrawing={!!part.hasDrawing}
            file={drawingFile ?? null}
            onClose={() => setDrawing(false)}
          />
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
              onClick={addOne}
              disabled={!current}
              className="overlay-btn absolute right-2 bottom-2 text-lg font-bold disabled:opacity-30"
              aria-label="One more made"
            >
              +
            </button>
          </>
        )}
      </div>
      {fabCounter ? (
        <FabFooter part={part} save={save} current={current ?? machines.at(-1)} made={made} editStatus={fabStatusEditable && work} />
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5 px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-1">
            <div className={`min-w-0 flex-1 truncate text-[0.8125rem] font-semibold text-fg ${checked ? "line-through" : ""}`} title={part.displayName ?? part.onshapeName ?? undefined}>
              {edit ? <NameField part={part} save={save} bare /> : (part.displayName ?? part.onshapeName ?? "Unnamed part")}
              {showSystem && <span className="ml-1.5 text-[0.6875rem] font-normal text-subtle">{part.systemName}</span>}
              {nameNote && <span className="ml-1.5 text-[0.6875rem] font-normal text-muted">{nameNote}</span>}
            </div>
            {showCounter && <DoneCounter part={part} save={save} slot={current!} />}
            {edit && <EditMenu part={part} />}
          </div>

          {statusButton ?? <div className="flex min-w-0 flex-wrap items-center gap-1">
            <StatusField part={part} save={save} size="sm" />
            {!post && !qa && (part.material || part.inventoryItemId || work) && <MaterialField part={part} save={save} className={pill} noOpen />}
            {!post && machines.map((slot, i) => (
              <span key={slot.key} className="contents">
                {(!qa || i > 0) && <span className="text-[0.625rem] text-faint">→</span>}
                <MachineField part={part} save={save} slot={slot} className={`${pill} ${slot === current ? "border-accent/60 text-accent" : ""}`} />
              </span>
            ))}
          </div>}
        </div>
      )}
    </div>
  );
}

// To Fab's − / + on a made part: + counts one more at the machine being worked on (the first slot
// whose done counter hasn't reached the quantity) and − takes back the last one counted. When −
// would leave nothing counted, the part goes back to In process if it was finished, else to Released.
// The rules live in fabCounts (src/lib/fab.ts); a finished part with nothing counted is fully made.
export function fabSteps(part: CardPart, save: SaveFn) {
  const c = fabCounts(part);
  const slot = (k: { key: string } | undefined) => SLOTS.find((s) => s.key === k?.key);
  const machines = SLOTS.filter((s) => part[s.key]);
  const takeBack = () => save("counters" in c.takeBack ? c.takeBack.counters : c.takeBack);
  const addOne = () => c.addOne && save(c.addOne);
  return { machines, current: slot(c.current), counted: slot(c.counted), finished: c.finished, made: c.made, takeBack, addOne };
}

// To Fab's rows: the status (its own menu inside a batch, else read-only) and how many are made of
// the amount, then the material and the machine it's at.
function FabFooter({ part, save, current, made, editStatus }: { part: CardPart; save: SaveFn; current: (typeof SLOTS)[number] | undefined; made: number; editStatus: boolean }) {
  const { inventory } = useBom();
  const linked = part.inventoryItemId ? inventory.find((i) => i.id === part.inventoryItemId) : undefined;
  const material = linked?.name ?? part.material;
  const machine = current ? (getMachine(part[current.key]!)?.name ?? part[current.key]) : null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-2.5 py-2">
      {/* The part's name always shows: a pale plate on the pale well can look like an empty card. */}
      <div className="min-w-0 truncate text-[0.8125rem] font-semibold text-fg" title={partTitle(part)}>
        {partTitle(part)}
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        {editStatus ? <StatusField part={part} save={save} size="sm" /> : <StatusPill status={computeStatus(part)} label={partStatusLabel(part)} />}
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
      </div>
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

const LABELS: Partial<Record<ExportFormat, string>> = { PARASOLID: "Parasolid", DXF: "Flat DXF", DXF_FLAT: "Flat DXF", STEP_FLAT: "Flat STEP" };
export const label = (f: ExportFormat) => LABELS[f] ?? f;

// Every way to download the part: the CAD exports (the first machine's format on top) and any
// files attached to it.
export function DownloadMenu({ part, format }: { part: CardPart; format: ExportFormat | null }) {
  // The plate DXF is offered for laser parts and thin plates; sheet metal has its own flat pattern.
  const plate = format === "DXF" || !!part.geometry?.wallMm;
  const all: ExportFormat[] = part.geometry?.sheetMetal ? [...FLAT, ...EXPORTABLE.filter((f) => f !== "DXF")] : EXPORTABLE.filter((f) => f !== "DXF" || plate);
  const exports = format ? [format, ...all.filter((f) => f !== format)] : [];
  const item = "flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-raised";
  return (
    <Popover align="right" hideCaret triggerClassName="overlay-btn" trigger={<><Icon name="download" /><span className="sr-only">Download</span></>}>
      {(close) => (
        <div className="space-y-0.5 text-sm">
          {exports.length > 0 && <div className="px-2 pb-1 text-[0.6875rem] font-semibold text-subtle">CAD from Onshape</div>}
          {exports.map((f, i) => (
            <a
              key={f}
              href={`/api/parts/${ownerPartId(part)}/export?format=${f}${part.fabView ? "&fab=1" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                close();
                void downloadExport(e.currentTarget.href);
              }}
              className={item}
            >
              <span className="font-medium text-fg">{label(f)}</span>
              {i === 0 && <span className="text-[0.6875rem] text-subtle">for its machine</span>}
            </a>
          ))}
          {part.hasDrawing && <div className="px-2 pt-2 pb-1 text-[0.6875rem] font-semibold text-subtle">Drawing</div>}
          {part.hasDrawing &&
            (["pdf", "png"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  close();
                  downloadDrawing(ownerPartId(part), f).catch((err: Error) => toast(err.message, true));
                }}
                className={`${item} w-full text-left`}
              >
                <span className="font-medium text-fg">{f.toUpperCase()}</span>
              </button>
            ))}
          {part.files.length > 0 && <div className="px-2 pt-2 pb-1 text-[0.6875rem] font-semibold text-subtle">Attached files</div>}
          {part.files.map((file) => (
            <a key={file.id} href={`/api/files/${file.id}?download=1`} onClick={close} className={item}>
              <span className="min-w-0 truncate text-fg" title={file.filename}>
                {file.filename}
              </span>
              <span className="shrink-0 text-[0.6875rem] text-subtle">{PART_FILE_TYPES.find((t) => t.id === file.type)?.label ?? file.type}</span>
            </a>
          ))}
        </div>
      )}
    </Popover>
  );
}

// How many are done at the current machine, with − / + for any team (it moves the status).
export function DoneCounter({ part, save, slot }: { part: CardPart; save: SaveFn; slot: (typeof SLOTS)[number] }) {
  const work = useCan("work");
  const done = part[slot.done];
  // One more (or one less) from the saved count, so two phones counting the same part both count.
  const step = (d: number) => save({ add: { [slot.done]: d } });
  return (
    // The shop's most-tapped control: 24px with a mouse, 36px under a finger (it was ~20×16).
    <span className="ml-auto inline-flex shrink-0 items-center rounded-full border border-line-strong bg-ink text-xs tabular-nums pointer-coarse:text-sm">
      {work && <button type="button" onClick={() => step(-1)} disabled={done === 0} className={COUNT_BTN} aria-label="One less done">
        −
      </button>}
      <span className={`font-semibold text-fg ${work ? "px-0.5" : "px-2 py-0.5"}`} title={`Done at ${getMachine(part[slot.key]!)?.name}`}>
        {done}/{part.quantity}
      </span>
      {work && <button type="button" onClick={() => step(1)} className={COUNT_BTN} aria-label="One more done">
        +
      </button>}
    </span>
  );
}

const COUNT_BTN = "press flex h-6 w-6 items-center justify-center rounded-full text-sm font-bold text-muted hover:bg-raised hover:text-fg active:scale-[0.9] disabled:opacity-30 pointer-coarse:h-9 pointer-coarse:w-9 pointer-coarse:text-base";

// The Merged tag: how many BOM rows the card stands for; a click offers Unmerge.
export function MergedBadge({ part }: { part: CardPart }) {
  const [pending, startTransition] = useTransition();
  if (!part.memberIds) return null;
  const n = part.memberIds.length;
  return (
    <Popover
      hideCaret
      triggerClassName="rounded-full border border-accent/40 bg-surface/95 px-2 py-0.5 text-[0.6875rem] leading-none font-bold text-accent shadow-sm hover:border-accent"
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
            className="block w-full rounded px-2 py-1.5 text-left text-rose-700 hover:bg-raised dark:text-rose-300 pointer-coarse:py-2.5"
            onClick={async () => {
              close();
              if (await askConfirm({ title: `Delete "${partTitle(part)}"?`, body: "It stays in Settings → Recently deleted for 30 days.", confirm: "Delete", danger: true })) startTransition(() => void deleteManualPart(part.id));
            }}
          >
            Delete part
          </button>
        </div>
      )}
    </Popover>
  );
}
