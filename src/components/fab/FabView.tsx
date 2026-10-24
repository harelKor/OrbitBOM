"use client";

import { useSearchParams } from "next/navigation";
import { useLayoutEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { MACHINES, getMachine } from "@/config/machines";
import type { Priority } from "@/config/priorities";
import { DONE_STATUSES, STATUSES, getStatus, statusLabel, type StatusName } from "@/config/statuses";
import { removeBatchGcode } from "@/app/(app)/files-actions";
import { createFabBatch, deleteGroup, moveToFabBatch, removeFromGroup, updateGroup } from "@/app/(app)/groups/actions";
import { updatePart, updateParts } from "@/app/(app)/parts-actions";
import { BomProvider, type InventoryName } from "@/components/bom/BomContext";
import { matchesTopBar } from "@/components/bom/filter";
import { upload } from "@/components/bom/FilesField";
import { OptionList, Popover } from "@/components/bom/Popover";
import { PartCard, cadFormat } from "@/components/bom/PartCard";
import { partTitle, type CardPart } from "@/components/bom/types";
import { useFilters } from "@/components/shell/FilterContext";
import { useEditMode } from "@/components/shell/ModeContext";
import { Chevron } from "@/components/ui/Chevron";
import { Icon } from "@/components/ui/Icon";
import { ShallowLink } from "@/components/ui/FastLink";
import { StatusPill } from "@/components/ui/StatusPill";
import { FINISHED_STATUS, IN_PROCESS_STATUS, READY_STATUS, fabStage, isFabFinished, machinesOf } from "@/lib/fab";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { computeStatus, statusMachine } from "@/lib/status";

export type Batch = {
  id: string;
  name: string;
  machine: string | null;
  madeBy: string | null;
  priority: Priority;
  gcode: { id: string; filename: string } | null;
};

// A batch's priority colours all its text. "normal" (the default) is no priority; the shop's three
// levels use the stored critical / high / low.
const BATCH_PRIORITIES = [
  { value: "critical", label: "High", color: "#dc2626" },
  { value: "high", label: "Mid", color: "#ea580c" },
  { value: "low", label: "Low", color: "#ca8a04" },
] as const satisfies readonly { value: Priority; label: string; color: string }[];
const priorityColor = (p: Priority) => BATCH_PRIORITIES.find((x) => x.value === p)?.color;

// A batch with mixed statuses takes the colour of its least advanced part (finished parts last).
const STATUS_RANK = new Map<string, number>(STATUSES.map((s, i) => [s.name, i]));
const rank = (p: CardPart) => (isFabFinished(p) ? Infinity : (STATUS_RANK.get(computeStatus(p)) ?? 0));

const isDone = (p: CardPart) => (DONE_STATUSES as string[]).includes(computeStatus(p));

// Dragging cards or batches between sections sets their status. Released holds loose parts only;
// Ready to Fab holds batches only (their parts are still Released: it is a To Fab section, not a status).
const DRAG_TYPE = "application/x-orbit-parts";
const SECTION_STATUS = { ready: READY_STATUS, readyToFab: READY_STATUS, inProcess: IN_PROCESS_STATUS, finished: FINISHED_STATUS } as const;
type Stage = keyof typeof SECTION_STATUS;
// What a drag carries: the parts, the section they come from (dropping back there does nothing),
// the batch they come from and whether it is the whole batch.
type DragLoad = { ids: string[]; from: Stage | null; batch: string | null; whole: boolean };
const partStage = (p: CardPart): Stage | null => (isFabFinished(p) ? "finished" : fabStage(p));

// A batch sits in Ready to Fab while any part still waits to start, then in In process, and in
// Finished once every part is done.
const batchStage = (members: CardPart[]): Stage =>
  members.every(isDone)
    ? "finished"
    : members.some((p) => fabStage(p) === "ready") || !members.some((p) => fabStage(p) === "inProcess")
      ? "readyToFab"
      : "inProcess";

const POST_PROCESSING: StatusName = "Post Processing";
const isPostProcessing = (p: CardPart) => computeStatus(p) === POST_PROCESSING;

// Cards take their status's colour; a batch takes it when all its parts share one status. On To
// Fab, finished parts and batches are painted green whatever their status.
const FINISHED_COLOR = "#16a34a";
const tint = (color: string | undefined): React.CSSProperties | undefined =>
  color ? { backgroundColor: `color-mix(in srgb, ${color} 14%, var(--color-surface))`, borderColor: `color-mix(in srgb, ${color} 60%, transparent)` } : undefined;
export const statusTint = (status: string | null) => tint(status ? getStatus(status)?.color : undefined);
// On To Fab, Released parts are plain: leads hand them out as batches, and Ready to Fab takes the colour.
const fabTint = (p: CardPart) => (isFabFinished(p) ? tint(FINISHED_COLOR) : computeStatus(p) === READY_STATUS ? {} : statusTint(computeStatus(p)));

const common = (lists: string[][]) => (lists.length ? lists.reduce((acc, l) => acc.filter((m) => l.includes(m))) : []);

// To Fab: machine boxes, then To Post Process (batches with parts in Post Processing), Released
// (loose parts), Ready to Fab (batches), In process and Finished (batches first, then parts), and
// for one machine its other parts. The Fab button picks cards of one material on one machine and
// turns them into a batch; dragging a Released part on or a part onto a batch does it too.
export function FabView({
  parts,
  batches,
  robotId,
  inventory,
  isAdmin,
  memberNames,
  me,
}: {
  parts: CardPart[];
  batches: Batch[];
  robotId: string;
  inventory: InventoryName[];
  isAdmin: boolean;
  memberNames: string[];
  me: string;
}) {
  const [optimistic, addOptimistic] = useOptimistic(parts, (state, { ids, changes }: { ids: string[]; changes: PartChanges }) =>
    state.map((p) => (ids.includes(p.id) ? { ...p, ...planPartUpdate(p, changes, "ui").set } : p)),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (ids: string[], changes: PartChanges) => {
    setError(null);
    startTransition(async () => {
      addOptimistic({ ids, changes });
      const r = ids.length === 1 ? await updatePart(ids[0], changes) : await updateParts(ids, changes);
      if (r.error) setError(r.error);
    });
  };

  const run = (task: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const r = await task();
      if (r.error) setError(r.error);
    });
  };
  // Parts in Post Processing checked off this visit, as they were when checked, so they stay in
  // their batch (struck through) until the member leaves.
  const [postChecked, setPostChecked] = useState<Map<string, CardPart>>(() => new Map());
  const checkPost = (p: CardPart) => {
    const undo = postChecked.has(p.id);
    setPostChecked((c) => {
      const next = new Map(c);
      if (undo) next.delete(p.id);
      else next.set(p.id, p);
      return next;
    });
    save([p.id], { status: undo ? POST_PROCESSING : FINISHED_STATUS });
  };

  const machine = useFabMachine();
  const { filters } = useFilters();
  const [fab, setFab] = useState(false);
  const [mine, setMine] = useState(false); // only the batches made by the signed-in member
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickedMachine, setPickedMachine] = useState("");
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onMachine = (p: CardPart) => !machine || machinesOf(p).includes(machine);

  // Per-machine counts of the parts in the queue, for the boxes.
  const counts = useMemo(() => {
    const byMachine = new Map<string, number>();
    let total = 0;
    for (const p of optimistic) {
      if (!fabStage(p)) continue;
      total += 1;
      for (const m of machinesOf(p)) byMachine.set(m, (byMachine.get(m) ?? 0) + 1);
    }
    return { total, byMachine };
  }, [optimistic]);

  const view = useMemo(() => {
    const shownBatches = batches
      .map((b) => ({ ...b, members: optimistic.filter((p) => p.groups.some((g) => g.id === b.id)) }))
      .filter(
        (b) =>
          b.members.length > 0 &&
          (!mine || b.madeBy === me) &&
          (machine ? (b.machine ? b.machine === machine : b.members.some(onMachine)) : true) &&
          b.members.some((p) => matchesTopBar(p, filters)),
      );
    const batched = new Set(shownBatches.flatMap((b) => b.members.map((p) => p.id)));
    const loose = optimistic.filter((p) => !batched.has(p.id) && onMachine(p) && matchesTopBar(p, filters));
    const batchesIn = (stage: Stage) => shownBatches.filter((b) => batchStage(b.members) === stage);
    // A batch with parts in Post Processing also shows them at the top; one waiting on nothing
    // else leaves In process for it.
    const post = shownBatches
      .map((b) => ({ ...b, post: [...b.members.filter((p) => isPostProcessing(p) && !postChecked.has(p.id)), ...[...postChecked.values()].filter((p) => p.groups.some((g) => g.id === b.id))] }))
      .filter((b) => b.post.length > 0);
    const onlyPost = new Set(post.filter((b) => b.members.filter((p) => !isDone(p)).every(isPostProcessing)).map((b) => b.id));
    // Each part shows once: in its batch, or in the section of its status.
    return {
      post,
      batches: { readyToFab: batchesIn("readyToFab"), inProcess: batchesIn("inProcess").filter((b) => !onlyPost.has(b.id)), finished: batchesIn("finished") },
      ready: mine ? [] : loose.filter((p) => partStage(p) === "ready"),
      inProcess: mine ? [] : loose.filter((p) => partStage(p) === "inProcess"),
      finished: mine ? [] : loose.filter((p) => partStage(p) === "finished"),
      other: machine && !mine ? loose.filter((p) => !partStage(p)) : [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMachine only reads `machine`
  }, [optimistic, batches, filters, machine, mine, me, postChecked]);

  // While picking a fab: the material of the first pick and the machines every pick goes through.
  const picked = optimistic.filter((p) => selected.has(p.id));
  const material = picked.length ? (picked[0].material ?? "") : null;
  const sharedMachines = machine ? [machine] : common(picked.map(machinesOf));
  const fabMachine = machine ?? (sharedMachines.includes(pickedMachine) ? pickedMachine : sharedMachines[0]);
  const canPick = (p: CardPart) =>
    selected.has(p.id) ||
    (machinesOf(p).some((m) => (picked.length ? sharedMachines : machine ? [machine] : MACHINES.map((x) => x.id as string)).includes(m)) &&
      (material === null || (p.material ?? "") === material));

  const card = (p: CardPart) => {
    const pickable = fab && canPick(p);
    return (
      <div
        key={p.id}
        draggable={!fab}
        onDragStart={(e) => {
          e.stopPropagation(); // a card inside an open batch moves alone
          const batch = batches.find((b) => p.groups.some((g) => g.id === b.id))?.id ?? null;
          e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ ids: [p.id], from: partStage(p), batch, whole: false } satisfies DragLoad));
        }}
        className={fab && !pickable ? "opacity-40" : undefined}
      >
        <PartCard
          part={p}
          save={(c) => save([p.id], c)}
          showSystem
          fabCounter
          style={fabTint(p)}
          selected={selected.has(p.id)}
          onToggleSelect={pickable ? () => toggle(p.id) : undefined}
        />
      </div>
    );
  };
  const batchCard = (b: Batch & { members: CardPart[] }) => (
    <BatchCard
      key={b.id}
      batch={b}
      members={b.members}
      save={save}
      card={card}
      draggable={!fab}
      memberNames={memberNames}
      onDropParts={fab ? undefined : (load) => run(() => moveToFabBatch(b.id, load.ids, load.batch, batchStatus(b.members)))}
    />
  );
  const machinesWithParts = MACHINES.filter((m) => counts.byMachine.has(m.id));
  const base = `/robots/${robotId}/fab`;
  // The machine a loose part is batched on: the one picked above, else the one it's at.
  const batchMachine = (p: CardPart) => (machine && machinesOf(p).includes(machine) ? machine : (statusMachine(p) ?? machinesOf(p)[0]));
  const drop = (stage: Stage) => (load: DragLoad) => {
    if (!load.ids.length) return;
    const status = SECTION_STATUS[stage];
    if (stage === "ready") {
      // Released takes loose parts only: a part dragged out of a batch leaves it.
      if (load.whole) return;
      if (load.batch) run(async () => (await removeFromGroup(load.batch!, load.ids[0]), {}));
      if (load.from !== "ready" || load.batch) save(load.ids, { status });
      return;
    }
    // A loose part moved out of Released, or onto Ready to Fab, gets a new batch of its own.
    if (!load.batch && (load.from === "ready" || stage === "readyToFab") && stage !== "finished") {
      const p = optimistic.find((x) => x.id === load.ids[0]);
      const m = p && batchMachine(p);
      if (!p || !m) {
        if (stage === "readyToFab") setError("Give the part a machine before it goes into a batch.");
        else save(load.ids, { status });
        return;
      }
      run(() => createFabBatch(robotId, load.ids, m, stage === "readyToFab" ? undefined : status));
      return;
    }
    if (load.from !== stage) save(load.ids, { status });
  };

  return (
    <BomProvider value={{ inventory, isAdmin, robotId }}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-stretch gap-2">
          <MachineBox href={base} name="All machines" count={counts.total} active={!machine} />
          {machinesWithParts.map((m) => (
            <MachineBox key={m.id} href={`${base}?machine=${m.id}`} name={m.name} count={counts.byMachine.get(m.id)!} active={machine === m.id} />
          ))}
          <button
            onClick={() => setMine((m) => !m)}
            aria-pressed={mine}
            className={`press ml-auto self-center ${mine ? "btn-primary" : "btn"}`}
          >
            My batches
          </button>
          <button
            onClick={() => {
              setFab((f) => !f);
              setSelected(new Set());
            }}
            aria-pressed={fab}
            className={`press self-center rounded-xl px-7 py-3 text-lg font-bold shadow-lg transition-colors ${
              fab ? "border border-line-strong bg-surface text-fg" : "bg-amber-400 text-slate-950 shadow-amber-400/40 hover:bg-amber-300"
            }`}
          >
            {fab ? "Cancel" : "＋ Fab"}
          </button>
        </div>

        {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}

        {view.post.length > 0 && (
          <section className="space-y-3 rounded-lg border p-4" style={{ borderColor: "color-mix(in srgb, #f302f7 40%, transparent)", backgroundColor: "color-mix(in srgb, #f302f7 4%, transparent)" }}>
            <div className="flex items-baseline gap-2">
              <h2 className="display text-2xl font-bold">To Post Process</h2>
              <span className="font-mono text-sm text-subtle tabular-nums">{view.post.reduce((n, b) => n + b.post.filter((p) => !postChecked.has(p.id)).length, 0)}</span>
              <span className="text-xs text-subtle">Check a part off to move it to Ready for QA.</span>
            </div>
            {view.post.map((b) => (
              <div key={b.id} className="space-y-2">
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="font-semibold">{b.name}</span>
                  {b.machine && <span className="text-xs text-subtle">{getMachine(b.machine)?.name}</span>}
                  {b.madeBy && <span className="text-xs text-subtle">· {b.madeBy}</span>}
                </div>
                <div className="card-grid" style={{ "--card-min": "200px" } as React.CSSProperties}>
                  {b.post.map((p) => (
                    <PartCard
                      key={p.id}
                      part={p}
                      save={(c) => save([p.id], c)}
                      showSystem
                      checked={postChecked.has(p.id)}
                      onCheck={() => checkPost(p)}
                      checkFrom={POST_PROCESSING}
                      checkTo={FINISHED_STATUS}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
        <Section title="Released" count={view.ready.length} empty="No parts are waiting to be made." onDropParts={fab ? undefined : drop("ready")}>
          {view.ready.map(card)}
        </Section>
        <Section
          title="Ready to Fab"
          count={view.batches.readyToFab.length}
          empty="Drag a Released part here, or use ＋ Fab, to make a batch."
          onDropParts={fab ? undefined : drop("readyToFab")}
        >
          {view.batches.readyToFab.map(batchCard)}
        </Section>
        <Section
          title="In process"
          count={view.batches.inProcess.length + view.inProcess.length}
          empty="Nothing is being made right now."
          onDropParts={fab ? undefined : drop("inProcess")}
        >
          {view.batches.inProcess.map(batchCard)}
          {view.inProcess.map(card)}
        </Section>
        <Section
          title="Finished"
          count={view.batches.finished.length + view.finished.length}
          empty="Parts land here once all of them are made."
          onDropParts={fab ? undefined : drop("finished")}
        >
          {view.batches.finished.map(batchCard)}
          {view.finished.map(card)}
        </Section>
        {machine && view.other.length > 0 && (
          <Section title={`Other parts on ${getMachine(machine)?.name ?? "this machine"}`} count={view.other.length} small defaultOpen={false}>
            {view.other.map(card)}
          </Section>
        )}

        {fab && (
          <div className="sticky bottom-3 z-30 rounded-xl border border-line-strong bg-surface/95 p-3 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold tabular-nums">{selected.size} selected</span>
              <span className="text-subtle">
                {material === null ? "Tap cards to add them to the fab." : `Only ${material || "parts with no material"} on the same machine can join.`}
              </span>
              <span className="ml-auto" />
              {machine ? (
                <span className="rounded-full bg-raised px-2.5 py-1 text-xs font-semibold">{getMachine(machine)?.name}</span>
              ) : (
                selected.size > 0 && (
                  <select
                    className="input w-auto py-1"
                    value={fabMachine ?? ""}
                    onChange={(e) => setPickedMachine(e.target.value)}
                    aria-label="Machine for this fab"
                  >
                    {sharedMachines.length === 0 && <option value="">No shared machine</option>}
                    {sharedMachines.map((m) => (
                      <option key={m} value={m}>
                        {getMachine(m)?.name ?? m}
                      </option>
                    ))}
                  </select>
                )
              )}
              <button
                className="btn-primary"
                disabled={pending || selected.size === 0 || !fabMachine}
                onClick={() =>
                  startTransition(async () => {
                    const r = await createFabBatch(robotId, [...selected], fabMachine!);
                    setError(r.error ?? null);
                    if (!r.error) {
                      setFab(false);
                      setSelected(new Set());
                    }
                  })
                }
              >
                ✓ Create fab
              </button>
              <button className="btn" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
                Clear
              </button>
            </div>
          </div>
        )}
      </div>
    </BomProvider>
  );
}

// The machine picked in the URL (?machine=). Read on the client so switching machines doesn't
// reload the page: the boxes and the sidebar change only the URL (ShallowLink).
function useFabMachine() {
  const id = useSearchParams().get("machine");
  return id && getMachine(id) ? id : undefined;
}

export function FabHeading({ robotName }: { robotName: string }) {
  const machine = useFabMachine();
  return (
    <div>
      <div className="text-xs font-semibold tracking-wide text-subtle uppercase">{robotName}</div>
      <h1 className="display text-3xl text-accent">To Fab{machine && ` · ${getMachine(machine)!.name}`}</h1>
    </div>
  );
}

function MachineBox({ href, name, count, active }: { href: string; name: string; count: number; active: boolean }) {
  return (
    <ShallowLink
      href={href}
      data-selected={active}
      className="card-interactive flex min-w-32 flex-col px-4 py-2.5"
    >
      <span className="display text-2xl text-accent tabular-nums">{count}</span>
      <span className="truncate text-xs font-medium text-fg-2">{name}</span>
    </ShallowLink>
  );
}

function Section({
  title,
  count,
  empty,
  onDropParts,
  small = false,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  empty?: string;
  onDropParts?: (load: DragLoad) => void;
  small?: boolean; // a quieter section at the bottom, with smaller cards
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  const dropProps = onDropParts && {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      setOver(false);
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      if (raw) {
        e.preventDefault();
        onDropParts(JSON.parse(raw) as DragLoad);
      }
    },
  };
  return (
    <section {...dropProps} className={`-m-2 space-y-3 rounded-xl p-2 transition-colors ${over ? "bg-accent/5 ring-2 ring-accent/40" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="press flex w-full items-center gap-3 text-left">
        <Chevron open={open} small={small} />
        <h2 className={small ? "text-base font-semibold text-fg-2" : "display text-2xl font-bold"}>{title}</h2>
        <span className={`rounded-full bg-raised font-bold text-fg-2 tabular-nums ${small ? "px-2 py-0.5 text-xs" : "px-2.5 py-0.5 text-sm"}`}>{count}</span>
        <div className={`flex-1 ${small ? "h-px bg-line" : "h-0.5 bg-line-strong"}`} />
      </button>
      {!open ? null : count === 0 && empty ? (
        <p className={`text-sm text-subtle ${onDropParts ? "rounded-lg border border-dashed border-line py-6 text-center" : ""}`}>{empty}</p>
      ) : (
        <div className="card-grid" style={{ "--card-min": small ? "150px" : "200px" } as React.CSSProperties}>{children}</div>
      )}
    </section>
  );
}

// The status a part dragged onto a batch takes: the batch's least advanced unfinished status
// (none once every part is done).
function batchStatus(members: CardPart[]): StatusName | null {
  const open = members.filter((p) => !isDone(p));
  if (!open.length) return null;
  return computeStatus(open.reduce((a, p) => (rank(p) < rank(a) ? p : a), open[0])) as StatusName;
}

// The collage's grid: one part fills it, two sit side by side, up to four in a 2×2, then 3×3.
function collageGrid(count: number): React.CSSProperties {
  const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
  const rows = count <= 2 ? 1 : count <= 4 ? 2 : 3;
  return { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` };
}

// A fab batch: a collage of its parts with who makes it on top, its machine and material, one
// status for all of them (named as the machine calls it), download all and its G-code. Clicking
// the card opens its member cards; cards dropped on it join it. Rename and delete are in Edit mode.
function BatchCard({
  batch,
  members,
  save,
  card,
  draggable,
  memberNames,
  onDropParts,
}: {
  batch: Batch;
  members: CardPart[];
  save: (ids: string[], changes: PartChanges) => void;
  card: (p: CardPart) => React.ReactNode;
  draggable: boolean;
  memberNames: string[];
  onDropParts?: (load: DragLoad) => void;
}) {
  const edit = useEditMode();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
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
  const qty = members.reduce((n, p) => n + p.quantity, 0);
  const materials = [...new Set(members.map((p) => p.material ?? ""))];
  const material = materials.length === 1 ? materials[0] || "No material" : "Mixed materials";
  const machineName = batch.machine ? (getMachine(batch.machine)?.name ?? batch.machine) : null;
  const downloads = members.flatMap((p) => {
    const f = cadFormat(p);
    return f ? [`/api/parts/${p.id}/export?format=${f}`] : [];
  });
  const notDone = members.filter((p) => !isDone(p));
  // The batch's status as its machine names it; a batch waiting to start is Ready to Fab.
  const label = (status: string) => (stage === "readyToFab" && status === READY_STATUS ? "Ready to Fab" : statusLabel(status, batch.machine));
  const statusOptions = STATUSES.map((s) => ({ value: s.name, label: s.name === READY_STATUS ? "Ready to Fab" : statusLabel(s.name, batch.machine), color: s.color }));
  const thumbs = members.slice(0, 9);

  // Opened, the batch takes a row of its own and lays its parts out at the grid's card width, as
  // many across as it has parts. Spanning only some columns let the closed cards beside it stretch
  // to its height, so they looked open too and jumped when it closed.
  const ref = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState(1);
  const [colWidth, setColWidth] = useState(0);
  useLayoutEffect(() => {
    const grid = ref.current?.parentElement;
    if (!open || !grid) return;
    const measure = () => {
      const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean);
      setSpan(Math.max(1, Math.min(cols.length, members.length)));
      setColWidth(parseFloat(cols[0]) || 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [open, members.length]);
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

  return (
    <div
      ref={ref}
      {...dropProps}
      draggable={draggable && !renaming}
      onDragStart={(e) =>
        e.dataTransfer.setData(
          DRAG_TYPE,
          JSON.stringify({ ids: (notDone.length ? notDone : members).map((p) => p.id), from: stage, batch: batch.id, whole: true } satisfies DragLoad),
        )
      }
      onClick={() => setOpen((o) => !o)}
      style={{
        ...(stage === "finished" || isFabFinished(lowest) ? tint(FINISHED_COLOR) : statusTint(computeStatus(lowest))),
        ...(open && { gridColumn: "1 / -1" }),
      }}
      className={`card-interactive flex cursor-pointer flex-col text-sm ${over ? "ring-2 ring-accent" : ""}`}
    >
      <div className={open ? "flex flex-wrap gap-4 p-3" : "flex flex-col"}>
        <div className={`relative shrink-0 ${open ? "w-40" : "w-full"}`}>
          <button
            aria-expanded={open}
            aria-label={open ? `Close ${batch.name}` : `Open ${batch.name}`}
            className={`thumb-well grid aspect-[4/3] w-full gap-px overflow-hidden ${open ? "rounded-lg" : ""}`}
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
            <select
              value={madeBy}
              onChange={(e) => {
                setMadeBy(e.target.value);
                startTransition(() => void updateGroup(batch.id, { madeBy: e.target.value || null }));
              }}
              aria-label={`Who makes ${batch.name}`}
              className="press max-w-full min-w-0 cursor-pointer truncate rounded-full border border-line bg-surface/90 px-2.5 py-1 text-xs font-bold text-fg shadow-sm backdrop-blur-md hover:border-accent focus:outline-none"
            >
              <option value="">Nobody yet</option>
              {[...new Set([...(batch.madeBy ? [batch.madeBy] : []), ...memberNames])].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <div className="min-w-0" style={textColor ? { color: textColor } : undefined}>
            {renaming ? (
              <input
                autoFocus
                defaultValue={batch.name}
                aria-label="Fab name"
                className="input py-1 text-base font-semibold"
                onClick={stop}
                onBlur={(e) => rename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") rename(e.currentTarget.value);
                  if (e.key === "Escape") setRenaming(false);
                }}
              />
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="display truncate text-xl text-accent" style={textColor ? { color: textColor } : undefined}>
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
            <div className={`text-xs tabular-nums ${textColor ? "" : "text-subtle"}`}>
              {members.length} parts, {qty} pcs
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2" onClick={stop}>
            <Popover trigger={<StatusPill status={shared ?? "Mixed"} label={shared ? label(shared) : undefined} size="md" />}>
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
            {open && (
              <select
                value={priority}
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
            )}
            <span className="ml-auto flex items-center gap-1.5">
              {downloads.length > 0 && (
                <button className="overlay-btn" onClick={() => downloadAll(downloads)} aria-label={`Download ${downloads.length} files`} title={`Download ${downloads.length} files`}>
                  <Icon name="download" />
                </button>
              )}
              {!open && batch.gcode && (
                <a className="overlay-btn" href={`/api/files/${batch.gcode.id}?download=1`} aria-label={`Download G-code ${batch.gcode.filename}`} title={`G-code: ${batch.gcode.filename}`}>
                  <Icon name="gcode" />
                </a>
              )}
            </span>
          </div>
          {open && <GcodeRow batch={batch} />}
          {open && edit && (
            <div className="mt-auto flex" onClick={stop}>
              <button
                className="press ml-auto shrink-0 text-xs text-subtle hover:text-rose-700"
                onClick={() => {
                  if (confirm(`Delete ${batch.name}? Its parts stay on the BOM with their status.`)) startTransition(() => void deleteGroup(batch.id));
                }}
              >
                Delete fab
              </button>
            </div>
          )}
        </div>
      </div>
      {open && (
        <div className="grid cursor-default gap-3 border-t border-line p-3" style={{ gridTemplateColumns: `repeat(${span}, ${colWidth ? `minmax(0, ${colWidth}px)` : "minmax(0, 1fr)"})` }} onClick={stop}>
          {members.map((p) => (
            <div key={p.id} className="flex flex-col gap-1">
              {card(p)}
              {edit && (
                <button
                  className="self-start text-xs text-subtle hover:text-rose-700"
                  onClick={() => startTransition(() => void removeFromGroup(batch.id, p.id))}
                >
                  Remove from {batch.name}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// An open batch's G-code: Upload G-code, or the file with Replace and Remove. Uploading moves the
// batch's parts that haven't started to Gcoded.
function GcodeRow({ batch }: { batch: Batch }) {
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
          <button className={btn} disabled={busy} onClick={() => input.current?.click()}>
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
          </button>
        </>
      ) : (
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
function downloadAll(urls: string[]) {
  urls.forEach((url, i) =>
    setTimeout(() => {
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.src = url;
      document.body.appendChild(frame);
      setTimeout(() => frame.remove(), 120_000);
    }, i * 1500),
  );
}
