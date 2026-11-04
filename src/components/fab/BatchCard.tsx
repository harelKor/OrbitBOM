"use client";

import { createContext, useContext, useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { createPortal, flushSync } from "react-dom";
import { getMachine } from "@/config/machines";
import type { Priority } from "@/config/priorities";
import { STATUSES, statusLabel, type StatusName } from "@/config/statuses";
import { removeBatchGcode } from "@/app/(app)/files-actions";
import { deleteGroup, removeFromGroup, updateGroup } from "@/app/(app)/groups/actions";
import { upload } from "@/components/bom/FilesField";
import { OptionList, Popover } from "@/components/bom/Popover";
import { cadFormat } from "@/components/bom/PartCard";
import { partTitle, type CardPart } from "@/components/bom/types";
import { useCan, useMode } from "@/components/shell/ModeContext";
import { pickableStatuses } from "@/components/shell/mode";
import { Chevron } from "@/components/ui/Chevron";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
import { READY_STATUS, isFabFinished } from "@/lib/fab";
import { type PartChanges } from "@/lib/parts/changes";
import { computeStatus, isDone } from "@/lib/status";
import { statusTint, tint } from "@/components/ui/statusTint";
import { downloadExport, prepareExport } from "@/components/bom/downloadExport";
import { BatchLayoutDialog } from "./BatchLayoutDialog";
import { OnshapeLayoutButton } from "./OnshapeLayoutButton";
import { type FabLayout, BATCH_PRIORITIES, priorityColor, rank, DRAG_TYPE, batchStage, FINISHED_COLOR, type Batch, type DragLoad } from "./fabModel";

// The collage's grid: one part fills it, two sit side by side, up to four in a 2×2, then 3×3.
export function collageGrid(count: number): React.CSSProperties {
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const rows = count <= 2 ? 1 : count <= 4 ? 2 : 3;
  return { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` };
}

// One open batch per section: opening a batch closes the one that was open.
export const OpenBatchContext = createContext<{ id: string | null; set: (id: string | null) => void } | null>(null);

// How wide an open batch is: as many of the section grid's columns as it has parts, at least two
// so its header has room, never more than the grid has. The grid places it (span only): in the
// slot it had when closed if it fits there, else at the start of the next row.
export type Place = { span: number; colWidth: number };
export function measurePlace(el: HTMLElement | null, parts: number): Place | null {
  const grid = el?.parentElement;
  if (!el || !grid) return null;
  const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean);
  const colWidth = parseFloat(cols[0]) || 0;
  return { span: Math.max(1, Math.min(cols.length, Math.max(parts, 2))), colWidth };
}

// Runs a layout change as a short view transition where the browser has them, so the eye can
// follow a batch as it opens or closes. The change does its own flushSync.
export function withTransition(change: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(change);
  else change();
}

// A fab batch: a collage of its parts, who makes it (on top of the collage; glowing when it's
// you), its machine and material, one status for all of them (named as the machine calls it),
// download all (on a closed batch only until it has G-code) and its G-code. Clicking the card opens it in place, with
// each part's own status; cards dropped on it join it. Rename and delete are in Edit mode.
export function BatchCard({
  batch,
  members,
  save,
  card,
  layout = "cards",
  draggable,
  memberNames,
  me,
  onDropParts,
}: {
  batch: Batch;
  members: CardPart[];
  save: (ids: string[], changes: PartChanges) => void;
  card: (p: CardPart, inBatch?: { batch: Batch; members: CardPart[] }) => React.ReactNode;
  layout?: FabLayout;
  draggable: boolean;
  memberNames: string[];
  me: string;
  onDropParts?: (load: DragLoad) => void;
}) {
  // Fab batches are Build Team work: any team renames, deletes and re-statuses them.
  const edit = useCan("work");
  // Setting one status for the whole batch: the CAD Team's statuses need a reason per part, so
  // they set those on each card; the Build Team picks from its own.
  const { mode } = useMode();
  const pickable = pickableStatuses(mode);
  const section = useContext(OpenBatchContext);
  const [ownOpen, setOwnOpen] = useState(false);
  const open = section ? section.id === batch.id : ownOpen;
  const setOpen = (next: boolean) => (section ? section.set(next ? batch.id : null) : setOwnOpen(next));
  const [renaming, setRenaming] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [over, setOver] = useState(false);
  const [madeBy, setMadeBy] = useState(batch.madeBy ?? "");
  const [, startTransition] = useTransition();
  const statuses = [...new Set(members.map((p) => computeStatus(p)))];
  const shared = statuses.length === 1 ? statuses[0] : null;
  const lowest = members.reduce((a, p) => (rank(p) < rank(a) ? p : a), members[0]);
  const [priority, setPriority] = useState(batch.priority);
  const stage = batchStage(members);
  // A finished batch drops its priority colour.
  const textColor = stage === "finished" ? undefined : priorityColor(priority);
  const materials = [...new Set(members.map((p) => p.material ?? ""))];
  const material = materials.length === 1 ? materials[0] || "No material" : "Mixed materials";
  const machineName = batch.machine ? (getMachine(batch.machine)?.name ?? batch.machine) : null;
  const downloads = members.flatMap((p) => {
    const f = cadFormat(p);
    return f ? [`/api/parts/${p.id}/export?format=${f}${p.fabView ? "&fab=1" : ""}`] : [];
  });
  // A laser batch (or one whose parts all cut from flat DXFs) downloads them as one zip.
  const dxfZip = batch.machine === "laser" || (members.length > 0 && members.every((p) => ["DXF", "DXF_FLAT"].includes(cadFormat(p) ?? "")));
  const notDone = members.filter((p) => !isDone(p));
  // The batch's status as its machine names it; a batch waiting to start is Ready to Fab.
  const label = (status: string) => (stage === "readyToFab" && status === READY_STATUS ? "Ready to Fab" : statusLabel(status, batch.machine));
  const statusOptions = STATUSES.filter((s) => !pickable || pickable.includes(s.name)).map((s) => ({ value: s.name, label: s.name === READY_STATUS ? "Ready to Fab" : statusLabel(s.name, batch.machine), color: s.color }));
  const thumbs = members.slice(0, 9);

  const mine = !!madeBy && madeBy === me;
  // Opened, the batch grows to the right and down from its slot (or from the next row's start when
  // it doesn't fit there), laying its parts out at the grid's card width, as many across as it has
  // parts and room for. Closed cards beside it keep their own height (self-start).
  const ref = useRef<HTMLDivElement>(null);
  const list = layout === "list";
  const [place, setPlace] = useState<Place | null>(null);
  const transitionName = `batch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const toggle = () => {
    const next = !open;
    withTransition(() => {
      // Close the section's other open batch first, so this one is measured in a settled grid.
      if (next && section?.id) flushSync(() => section.set(null));
      const nextPlace = next && !list ? measurePlace(ref.current, members.length) : null;
      flushSync(() => {
        setPlace(nextPlace);
        setOpen(next);
      });
    });
  };
  useLayoutEffect(() => {
    const grid = ref.current?.parentElement;
    if (!open || !grid || list) return;
    const observer = new ResizeObserver(() => setPlace(measurePlace(ref.current, members.length)));
    observer.observe(grid);
    return () => observer.disconnect();
  }, [open, members.length, list]);
  const wide = open && (place?.span ?? 1) >= 2;
  const batchTint = stage === "finished" || isFabFinished(lowest) ? tint(FINISHED_COLOR) : statusTint(computeStatus(lowest));
  const userBox = (
    <select
      value={madeBy}
      disabled={!edit}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        setMadeBy(e.target.value);
        startTransition(() => void updateGroup(batch.id, { madeBy: e.target.value || null }));
      }}
      aria-label={`Who makes ${batch.name}`}
      title={mine ? "You make this batch" : undefined}
      className={`press max-w-full min-w-0 cursor-pointer truncate rounded-full border bg-surface/90 px-2 py-0.5 text-[11px] font-bold shadow-sm backdrop-blur-md transition-shadow hover:border-accent focus:outline-none ${
        mine ? "border-sky-400 text-sky-600 shadow-[0_0_10px_2px_rgba(56,189,248,0.55)] dark:text-sky-300" : "border-line-strong text-fg"
      }`}
    >
      <option value="">Nobody yet</option>
      {[...new Set([...(batch.madeBy ? [batch.madeBy] : []), ...memberNames])].map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
  const rename = (name: string) => {
    setRenaming(false);
    if (name.trim() && name.trim() !== batch.name) startTransition(() => void updateGroup(batch.id, { name }));
  };
  // Controls inside the card don't open or close it.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  // Cards from elsewhere dropped on the batch join it (a whole batch doesn't).
  const dropProps = onDropParts && {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      setOver(false);
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      const load = JSON.parse(raw) as DragLoad;
      if (!load.whole && load.batch !== batch.id && load.ids.length) onDropParts(load);
    },
  };

  const dragStart = (e: React.DragEvent) =>
    e.dataTransfer.setData(
      DRAG_TYPE,
      JSON.stringify({ ids: (notDone.length ? notDone : members).map((p) => p.id), from: stage, batch: batch.id, whole: true } satisfies DragLoad),
    );
  const nameInput = (
    <input
      autoFocus
      defaultValue={batch.name}
      aria-label="Fab name"
      className="input py-1 text-base font-semibold"
      onClick={stop}
      onBlur={(e) => rename(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") rename(e.currentTarget.value);
        if (e.key === "Escape") setRenaming(false);
      }}
    />
  );
  const statusMenu = (
    <Popover locked={!edit || mode === "cad"} trigger={<StatusPill status={shared ?? "Mixed"} label={shared ? label(shared) : undefined} size={list ? "sm" : "md"} />}>
      {(close) => (
        <OptionList
          options={statusOptions}
          value={shared}
          placeholder="Set status for all…"
          onPick={(v) => {
            if (v) save(members.map((p) => p.id), { status: v as StatusName });
            close();
          }}
        />
      )}
    </Popover>
  );
  const prioritySelect = (
    <select
      value={priority}
      disabled={!edit}
      onChange={(e) => {
        const next = e.target.value as Priority;
        setPriority(next);
        startTransition(() => void updateGroup(batch.id, { priority: next }));
      }}
      aria-label={`Priority of ${batch.name}`}
      className="cursor-pointer rounded-full border border-line-strong bg-surface px-2 py-1 text-xs font-bold"
      style={textColor ? { color: textColor } : undefined}
    >
      <option value="normal">No priority</option>
      {BATCH_PRIORITIES.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
    </select>
  );
  const autoLayoutButton = (
    <button
      className="press flex items-center gap-1 rounded-full border border-line-strong bg-surface px-2.5 py-1 text-xs font-bold text-fg-2 transition-colors duration-150 hover:border-sky-400/40 hover:text-sky-500 active:scale-[0.98]"
      onClick={() => setLayoutOpen(true)}
      title="Lay the parts flat and nest them on the smallest plate on the shelf"
    >
      <Icon name="layers" className="h-3.5 w-3.5" />
      Auto Layout
    </button>
  );
  const layoutDialog =
    layoutOpen &&
    createPortal(
      // The window sits outside the card in the page, but React still hands its clicks to the card.
      <div onClick={stop} onDoubleClick={stop}>
        <BatchLayoutDialog groupId={batch.id} name={batch.name} machine={batch.machine} open onClose={() => setLayoutOpen(false)} />
      </div>,
      document.body,
    );
  const downloadButtons = (
    <>
      {downloads.length > 0 && !(batch.gcode && !open) && (
        <button className="overlay-btn" onClick={() => void downloadAll(downloads)} aria-label={`Download ${downloads.length} files`} title={`Download ${downloads.length} files`}>
          <Icon name="download" />
        </button>
      )}
      {/* A laser batch's whole sheet, laid out as in Auto Layout, in one DXF. */}
      {batch.machine === "laser" && (
        <button
          className="overlay-btn w-auto gap-1 px-2 text-xs font-semibold"
          onClick={() => void downloadExport(`/api/groups/${batch.id}/layout-dxf`)}
          aria-label={`Download ${batch.name} sheet layout as one DXF`}
          title="The whole sheet as one DXF: every copy where Auto Layout put it"
        >
          <Icon name="download" />
          Layout DXF
        </button>
      )}
      {dxfZip && downloads.length > 0 && (
        <button
          className="overlay-btn w-auto gap-1 px-2 text-xs font-semibold"
          onClick={() => void downloadExport(`/api/groups/${batch.id}/dxf`)}
          aria-label={`Download ${batch.name} flat DXFs as a zip`}
          title="All flat DXFs in one zip, named with each part's quantity"
        >
          <Icon name="download" />
          DXF zip
        </button>
      )}
      {!open && batch.gcode && (
        <a className="overlay-btn" href={`/api/files/${batch.gcode.id}?download=1`} aria-label={`Download G-code ${batch.gcode.filename}`} title={`G-code: ${batch.gcode.filename}`}>
          <Icon name="gcode" />
        </a>
      )}
    </>
  );
  const deleteButton = (
    <button
      className="press shrink-0 text-xs text-subtle hover:text-rose-700"
      onClick={() => {
        if (confirm(`Delete ${batch.name}? Its parts stay on the BOM with their status.`)) startTransition(() => void deleteGroup(batch.id));
      }}
    >
      Delete fab
    </button>
  );
  const removeButton = (p: CardPart) =>
    edit && (
      <button className="self-start text-xs text-subtle hover:text-rose-700" onClick={() => startTransition(() => void removeFromGroup(batch.id, p.id))}>
        Remove from {batch.name}
      </button>
    );

  if (list) {
    // The List view: one row (collage, name, material · machine, who makes it, status, downloads,
    // chevron); a click folds the batch open below it, with its actions and then its parts as rows.
    const small = members.slice(0, 4);
    return (
      <div
        ref={ref}
        {...dropProps}
        draggable={draggable && !renaming}
        onDragStart={dragStart}
        className="min-w-0"
        style={open ? { gridColumn: "1 / -1" } : undefined}
      >
        <div
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={toggle}
          onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && toggle()}
          style={{ ...batchTint, ...(mine && { boxShadow: "0 0 0 2px rgba(56,189,248,0.75), 0 0 18px 3px rgba(56,189,248,0.35)" }) }}
          className={`flex min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-line bg-surface/90 py-2.5 pr-2.5 pl-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] transition-all duration-150 hover:border-sky-400/40 active:not-[:has(:is(button,a,input,select,textarea,[role=dialog]):active)]:scale-[0.99] ${over ? "ring-2 ring-accent" : ""}`}
        >
          <span className="grid h-14 w-14 shrink-0 gap-px overflow-hidden rounded-xl bg-white" style={collageGrid(small.length)}>
            {small.map((p) => (
              <span key={p.id} className="flex min-h-0 min-w-0 items-center justify-center bg-white">
                {p.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links
                  <img src={p.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain p-0.5" />
                ) : (
                  <Icon name="box" className="h-4 w-4 text-slate-400" />
                )}
              </span>
            ))}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            {renaming ? (
              nameInput
            ) : (
              <span className="truncate text-base font-bold text-accent" style={textColor ? { color: textColor } : undefined}>
                {batch.name}
              </span>
            )}
            <span className={`truncate text-xs font-medium ${textColor ? "" : "text-muted"}`} style={textColor ? { color: textColor } : undefined}>
              {material}
              {machineName && ` · ${machineName}`}
            </span>
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5" onClick={stop}>
              <span className="min-w-0 max-w-40">{userBox}</span>
              {statusMenu}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1" onClick={stop}>
            {downloadButtons}
          </span>
          <Chevron open={open} small />
        </div>
        {open && (
          <div className="mt-2 space-y-2 border-l-2 border-accent/40 pl-3 sm:pl-5" onClick={stop}>
            <div className="flex flex-wrap items-center gap-2">
              {prioritySelect}
              {autoLayoutButton}
              <OnshapeLayoutButton groupId={batch.id} url={batch.onshapeLayoutUrl} where="card" />
              {edit && !renaming && (
                <button className="press shrink-0 text-xs text-subtle hover:text-accent" onClick={() => setRenaming(true)}>
                  Rename
                </button>
              )}
              {edit && <span className="ml-auto">{deleteButton}</span>}
            </div>
            <GcodeRow batch={batch} />
            <div className="list-stack" style={{ zoom: 1 }}>
              {members.map((p) => (
                <div key={p.id} className="flex min-w-0 flex-col gap-1">
                  {card(p, { batch, members })}
                  {removeButton(p)}
                </div>
              ))}
            </div>
          </div>
        )}
        {layoutDialog}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      {...dropProps}
      draggable={draggable && !renaming}
      onDragStart={dragStart}
      onClick={toggle}
      style={{
        ...batchTint,
        ...(open && place && { gridColumn: `span ${place.span}` }),
        ...(mine && { boxShadow: "0 0 0 2px rgba(56,189,248,0.75), 0 0 22px 4px rgba(56,189,248,0.4)" }),
        viewTransitionName: transitionName,
        viewTransitionClass: "fab-batch",
      }}
      className={`card-interactive flex cursor-pointer flex-col self-start text-sm ${over ? "ring-2 ring-accent" : ""}`}
    >
      {/* Open and at least two columns wide, the collage sits beside the details (which wrap below
          it if they'd get narrower than 12rem); one column wide, it stacks like a closed card. */}
      <div className={wide ? "flex flex-wrap gap-x-4 p-3" : "flex flex-col"}>
        <div className={`relative shrink-0 ${wide ? "w-40" : "w-full"}`}>
          <button
            aria-expanded={open}
            aria-label={open ? `Close ${batch.name}` : `Open ${batch.name}`}
            className={`thumb-well grid aspect-[4/3] w-full gap-px overflow-hidden ${wide ? "rounded-lg" : ""}`}
            style={collageGrid(thumbs.length)}
          >
            {thumbs.map((p) => (
              <span key={p.id} className="flex min-h-0 items-center justify-center bg-well">
                {p.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links
                  <img src={p.thumbUrl} alt="" loading="lazy" className={`h-full w-full object-contain ${thumbs.length === 1 ? "p-3" : "p-1.5"}`} />
                ) : (
                  <span className="px-1 text-center text-[10px] text-subtle">{partTitle(p)}</span>
                )}
              </span>
            ))}
          </button>
          <div className="absolute inset-x-2 top-2 flex" onClick={stop}>
            {userBox}
          </div>
        </div>
        <div className={`flex flex-1 flex-col gap-2 ${wide ? "min-w-[12rem] py-3 pl-1" : "min-w-0 p-3"}`}>
          <div className="min-w-0" style={textColor ? { color: textColor } : undefined}>
            {renaming ? (
              nameInput
            ) : (
              <div className="flex items-center gap-2">
                <span className="display min-w-0 truncate text-xl text-accent" style={textColor ? { color: textColor } : undefined}>
                  {batch.name}
                </span>
                {open && edit && (
                  <button
                    className="press shrink-0 text-xs text-subtle hover:text-accent"
                    onClick={(e) => {
                      stop(e);
                      setRenaming(true);
                    }}
                  >
                    Rename
                  </button>
                )}
              </div>
            )}
            <div className={`truncate text-xs font-medium ${textColor ? "" : "text-fg-2"}`}>
              {material}
              {machineName && ` · ${machineName}`}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2" onClick={stop}>
            {statusMenu}
            {open && prioritySelect}
            {open && autoLayoutButton}
            {open && <OnshapeLayoutButton groupId={batch.id} url={batch.onshapeLayoutUrl} where="card" />}
            {layoutDialog}
            <span className="ml-auto flex items-center gap-1.5">{downloadButtons}</span>
          </div>
          {open && <GcodeRow batch={batch} />}
          {open && edit && (
            <div className="mt-auto flex justify-end" onClick={stop}>
              {deleteButton}
            </div>
          )}
        </div>
      </div>
      {open && (
        <div
          className="batch-open grid cursor-default gap-3 border-t border-line p-3"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, Math.min(members.length, place?.span ?? 1))}, ${place?.colWidth ? `minmax(0, ${place.colWidth}px)` : "minmax(0, 1fr)"})`,
          }}
          onClick={stop}
        >
          {members.map((p) => (
            <div key={p.id} className="flex flex-col gap-1">
              {card(p, { batch, members })}
              {removeButton(p)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// An open batch's G-code: Upload G-code, or the file with Replace and Remove. Uploading moves the
// batch's parts that haven't started to Gcoded.
export function GcodeRow({ batch }: { batch: Batch }) {
  const work = useCan("work");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (task: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    setError(await task());
    setBusy(false);
  };
  const btn = "press rounded-md border border-line-strong px-2 py-1 text-xs font-semibold text-fg-2 hover:border-accent hover:text-accent disabled:opacity-50";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
      <input
        ref={input}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void run(() => upload({ kind: "group", id: batch.id }, "gcode", file));
        }}
      />
      {batch.gcode ? (
        <>
          <a href={`/api/files/${batch.gcode.id}?download=1`} className="flex min-w-0 items-center gap-1 font-medium text-fg hover:text-accent" title={batch.gcode.filename}>
            <Icon name="gcode" className="h-4 w-4 shrink-0" />
            <span className="truncate">{batch.gcode.filename}</span>
          </a>
          {work && <><button className={btn} disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Uploading…" : "Replace"}
          </button>
          <button
            className={`${btn} hover:border-rose-500 hover:text-rose-700`}
            disabled={busy}
            onClick={() => {
              if (confirm(`Remove the G-code from ${batch.name}?`)) void run(async () => (await removeBatchGcode(batch.id)).error ?? null);
            }}
          >
            Remove
          </button></>}
        </>
      ) : !work ? null : (
        <button className={`${btn} flex items-center gap-1`} disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="gcode" className="h-4 w-4" />
          {busy ? "Uploading…" : "Upload G-code"}
        </button>
      )}
      {error && <span className="text-rose-700">{error}</span>}
    </div>
  );
}

// One file after another: each export can take a while the first time, so they are spaced out.
// One file after another; stops at the first part Onshape can't export (its reason shows as a
// toast), since the rest would most likely fail the same way.
export async function downloadAll(urls: string[]) {
  for (const [i, url] of urls.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500));
    const file = await prepareExport(url);
    if (!file) return;
    if (file.filename) {
      const a = document.createElement("a");
      a.href = file.href;
      a.download = file.filename;
      a.click();
      continue;
    }
    // A hidden frame per file, so the browser doesn't stop a run of downloads.
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.src = file.href;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), 120_000);
  }
}
