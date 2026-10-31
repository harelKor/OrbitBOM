"use client";

import { useSearchParams } from "next/navigation";
import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { createPortal, flushSync } from "react-dom";
import { MACHINES, getMachine } from "@/config/machines";
import type { Priority } from "@/config/priorities";
import { materialColor } from "@/config/materialColors";
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
import { useMaterialColors, useMaterials } from "@/components/shell/MaterialColors";
import { pushQuery } from "@/components/ui/CategoryBoxes";
import { useCan, useMode } from "@/components/shell/ModeContext";
import { pickableStatuses } from "@/components/shell/mode";
import { Chevron } from "@/components/ui/Chevron";
import { Icon } from "@/components/ui/Icon";
import { ShallowLink } from "@/components/ui/FastLink";
import { StatusPill } from "@/components/ui/StatusPill";
import { useEscape } from "@/components/ui/useEscape";
import { FINISHED_STATUS, IN_PROCESS_STATUS, READY_STATUS, fabBatchName, fabStage, isFabFinished, machinesOf } from "@/lib/fab";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { computeStatus, statusMachine } from "@/lib/status";
import { prepareExport } from "@/components/bom/downloadExport";
import { BatchLayoutDialog } from "./BatchLayoutDialog";

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

// The material filter boxes go by the exact material ("3mm 6061-T6"); NO_MATERIAL stands for none.
const NO_MATERIAL_KEY = "none";
const materialKeyOf = (p: CardPart) => p.material || NO_MATERIAL_KEY;

// A batch part with no machine or no material can take them from the rest of the batch: the
// material of a part that has one, and the machines of a part that has them (else the batch's).
function inheritFromBatch(p: CardPart, batch: Batch, members: CardPart[]): PartChanges | null {
  const others = members.filter((m) => m.id !== p.id);
  const changes: PartChanges = {};
  const material = others.find((m) => m.material)?.material;
  if (!p.material && material) changes.material = material;
  if (!machinesOf(p).length) {
    const donor = others.find((m) => machinesOf(m).length > 0);
    if (donor) Object.assign(changes, { preProcess: donor.preProcess, process1: donor.process1, process2: donor.process2 });
    else if (batch.machine) changes.process1 = batch.machine;
  }
  return Object.keys(changes).length ? changes : null;
}

// A released part on To Fab shows the state it was released at (plan/fab-version-lock.md): its
// amount and picture then, and a red Changed tag when the BOM has moved past it since.
function fabState(p: CardPart): CardPart {
  const lock = p.fabLock;
  if (!lock) return p;
  return { ...p, quantity: lock.quantity, thumbUrl: lock.thumbUrl ?? p.thumbUrl, fabView: { changed: lock.changed } };
}

// To Fab: machine boxes, then To Post Process (batches with parts in Post Processing), Released
// (loose parts), Ready to Fab (batches), In process and Finished (batches first, then parts), and
// for one machine its other parts. Material boxes (?mat=) filter all of it. The Fab button (or a
// long press on a Released card on a phone) picks cards of one material on one machine and turns
// them into a batch or adds them to an existing one; dragging a Released part on or a part onto a
// batch does it too.
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
  // Any team works the To Fab page; without a team (read only) nothing moves or changes.
  const work = useCan("work");
  const locked = useMemo(() => parts.map(fabState), [parts]);
  const [optimistic, addOptimistic] = useOptimistic(locked, (state, { ids, changes }: { ids: string[]; changes: PartChanges }) =>
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
  // Parts in Post Processing checked off this visit: they stay in their place in the batch, struck
  // through, until the member leaves.
  const [postChecked, setPostChecked] = useState<Set<string>>(() => new Set());
  const markPost = (id: string, on: boolean) =>
    setPostChecked((c) => {
      const next = new Set(c);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  // The check moves the part to Ready for QA with all of it post-processed; undo puts it back.
  const checkPost = (p: CardPart) => {
    const undo = postChecked.has(p.id);
    const need = Math.max(p.quantity, 1);
    markPost(p.id, !undo);
    save([p.id], undo ? { status: POST_PROCESSING, postDone: Math.min(p.postDone, need - 1) } : { status: FINISHED_STATUS, postDone: need });
  };
  // − / + count the pieces post-processed; the part leaves Post Processing only once all are done.
  const countPost = (p: CardPart, n: number) => {
    const need = Math.max(p.quantity, 1);
    const done = Math.min(Math.max(n, 0), need);
    const wasChecked = postChecked.has(p.id);
    // Sent as a step from the saved count, so two phones counting the same part both count.
    const add = { postDone: done - p.postDone };
    if (done >= need && !wasChecked) {
      markPost(p.id, true);
      save([p.id], { add, status: FINISHED_STATUS });
    } else if (done < need && wasChecked) {
      markPost(p.id, false);
      save([p.id], { add, status: POST_PROCESSING });
    } else save([p.id], { add });
  };

  const machine = useFabMachine();
  const { filters } = useFilters();
  const [fab, setFab] = useState(false);
  const searchParams = useSearchParams();
  // Only the batches made by the signed-in member; the dashboard's My Batches box opens it on (?mine=1).
  const [mine, setMine] = useState(() => searchParams.get("mine") === "1");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickedMachine, setPickedMachine] = useState("");
  const [target, setTarget] = useState(""); // the batch the Fab button adds to ("" = a new one)
  const [batchName, setBatchName] = useState<string | null>(null); // typed in the Fab bar; null = the default
  // Long-pressing a Released card on a phone turns on Fab with that card picked.
  const press = useRef<{ timer: number | null; fired: boolean }>({ timer: null, fired: false });
  const endPress = () => {
    if (press.current.timer) clearTimeout(press.current.timer);
    press.current.timer = null;
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const onMachine = (p: CardPart) => !machine || machinesOf(p).includes(machine);

  // Per-machine counts of the parts in the queue, for the boxes. With My batches on, only the
  // parts in the member's own batches count, so machines and materials with none of them hide.
  const myBatchIds = useMemo(
    () => (mine ? new Set(batches.filter((b) => b.madeBy === me).map((b) => b.id)) : null),
    [mine, batches, me],
  );
  const counts = useMemo(() => {
    const byMachine = new Map<string, number>();
    const byMaterial = new Map<string, number>();
    const materialsOn = new Map<string, Set<string>>(); // machine -> materials of its queue parts
    let total = 0;
    for (const p of optimistic) {
      if (!fabStage(p)) continue;
      if (myBatchIds && !p.groups.some((g) => myBatchIds.has(g.id))) continue;
      total += 1;
      const key = materialKeyOf(p);
      for (const m of machinesOf(p)) {
        byMachine.set(m, (byMachine.get(m) ?? 0) + 1);
        materialsOn.set(m, (materialsOn.get(m) ?? new Set()).add(key));
      }
      if (!machine || machinesOf(p).includes(machine)) byMaterial.set(key, (byMaterial.get(key) ?? 0) + 1);
    }
    return { total, byMachine, byMaterial, materialsOn };
  }, [optimistic, machine, myBatchIds]);

  // ?mat= : the material filter box picked. A material with no parts on the machine picked is
  // dropped, so switching machines never leaves an empty filter.
  const rawMat = searchParams.get("mat");
  const mat = rawMat && counts.byMaterial.has(rawMat) ? rawMat : null;
  const matchesMat = (p: CardPart) => !mat || materialKeyOf(p) === mat;
  useEffect(() => {
    if (rawMat && !mat) {
      const url = new URL(window.location.href);
      url.searchParams.delete("mat");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, [rawMat, mat]);
  const base = `/robots/${robotId}/fab`;
  // Machine boxes keep the material picked when that machine has parts of it.
  const machineHref = (id: string | null) => {
    const q = new URLSearchParams();
    if (id) q.set("machine", id);
    if (mat && (!id || counts.materialsOn.get(id)?.has(mat))) q.set("mat", mat);
    return q.size ? `${base}?${q}` : base;
  };

  const view = useMemo(() => {
    const shownBatches = batches
      .map((b) => ({ ...b, members: optimistic.filter((p) => p.groups.some((g) => g.id === b.id)) }))
      .filter(
        (b) =>
          b.members.length > 0 &&
          (!mine || b.madeBy === me) &&
          (machine ? (b.machine ? b.machine === machine : b.members.some(onMachine)) : true) &&
          b.members.some((p) => matchesTopBar(p, filters) && matchesMat(p)),
      );
    const batched = new Set(shownBatches.flatMap((b) => b.members.map((p) => p.id)));
    const loose = optimistic.filter((p) => !batched.has(p.id) && onMachine(p) && matchesTopBar(p, filters) && matchesMat(p));
    const batchesIn = (stage: Stage) => shownBatches.filter((b) => batchStage(b.members) === stage);
    // A batch with parts in Post Processing also shows them at the top (and stays where it is
    // below); checked-off parts keep their place.
    const post = shownBatches
      .map((b) => ({ ...b, post: b.members.filter((p) => isPostProcessing(p) || postChecked.has(p.id)) }))
      .filter((b) => b.post.length > 0);
    // Each part shows once per section: in its batch, or in the section of its status.
    return {
      post,
      batches: { readyToFab: batchesIn("readyToFab"), inProcess: batchesIn("inProcess"), finished: batchesIn("finished") },
      ready: mine ? [] : loose.filter((p) => partStage(p) === "ready"),
      inProcess: mine ? [] : loose.filter((p) => partStage(p) === "inProcess"),
      finished: mine ? [] : loose.filter((p) => partStage(p) === "finished"),
      other: machine && !mine ? loose.filter((p) => !partStage(p)) : [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMachine and matchesMat only read `machine` and `mat`
  }, [optimistic, batches, filters, machine, mat, mine, me, postChecked]);

  // While picking a fab: the material of the first pick and the machines every pick goes through.
  const picked = optimistic.filter((p) => selected.has(p.id));
  const material = picked.length ? (picked[0].material ?? "") : null;
  const sharedMachines = machine ? [machine] : common(picked.map(machinesOf));
  const fabMachine = machine ?? (sharedMachines.includes(pickedMachine) ? pickedMachine : sharedMachines[0]);
  // The batches the Fab button can add to: unfinished ones on the machine (and of the material) of
  // the picks.
  const openBatches = batches
    .map((b) => ({ ...b, members: optimistic.filter((p) => p.groups.some((g) => g.id === b.id)) }))
    .filter((b) => b.members.length > 0 && batchStage(b.members) !== "finished");
  const batchMaterial = (b: { members: CardPart[] }) => b.members.find((p) => p.material)?.material ?? "";
  const fitsBatch = (p: CardPart, b: Batch & { members: CardPart[] }) =>
    (!b.machine || !machinesOf(p).length || machinesOf(p).includes(b.machine)) && (!p.material || !batchMaterial(b) || p.material === batchMaterial(b));
  const targetOptions = openBatches.filter((b) => (!machine || !b.machine || b.machine === machine) && picked.every((p) => fitsBatch(p, b)));
  const targetBatch = targetOptions.find((b) => b.id === target) ?? null;
  const batchOf = (p: CardPart) => batches.find((b) => p.groups.some((g) => g.id === b.id))?.id ?? null;
  // Only loose parts can be picked: a part already in a batch stays there. Adding to a batch also
  // takes parts with no machine or material yet: they inherit them there.
  const canPick = (p: CardPart) =>
    selected.has(p.id) ||
    (!batchOf(p) &&
      (targetBatch
        ? fitsBatch(p, targetBatch)
        : machinesOf(p).some((m) => (picked.length ? sharedMachines : machine ? [machine] : MACHINES.map((x) => x.id as string)).includes(m)) &&
          (material === null || (p.material ?? "") === material)));
  const startFab = (on: boolean) => {
    setFab(on);
    setSelected(new Set());
    setTarget("");
    setBatchName(null);
  };
  useEscape(fab, () => startFab(false));
  const defaultBatchName = fabMachine ? fabBatchName(getMachine(fabMachine)?.name ?? "Batch") : "";
  const submitFab = () =>
    startTransition(async () => {
      let r: { error?: string };
      if (targetBatch) r = await moveToFabBatch(targetBatch.id, [...selected], null, batchStatus(targetBatch.members));
      else r = await createFabBatch(robotId, [...selected], fabMachine!, undefined, batchName ?? undefined);
      setError(r.error ?? null);
      if (!r.error) startFab(false);
    });

  // A To Fab card; inside a batch its status can be changed on its own, and a part missing its
  // machine or material gets a glowing button that copies them from the rest of the batch.
  const card = (p: CardPart, inBatch?: { batch: Batch; members: CardPart[] }) => {
    const pickable = fab && canPick(p);
    const inherit = inBatch && (!p.material || !machinesOf(p).length) ? inheritFromBatch(p, inBatch.batch, inBatch.members) : null;
    // A loose Released card: a long press on a phone starts the Fab picking with it.
    const longPress = work && !fab && !inBatch && partStage(p) === "ready";
    return (
      <div
        key={p.id}
        draggable={!fab && work}
        onDragStart={(e) => {
          endPress();
          e.stopPropagation(); // a card inside an open batch moves alone
          e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ ids: [p.id], from: partStage(p), batch: batchOf(p), whole: false } satisfies DragLoad));
        }}
        {...(longPress && {
          onPointerDown: (e: React.PointerEvent) => {
            if (e.pointerType !== "touch") return;
            endPress();
            press.current.fired = false;
            press.current.timer = window.setTimeout(() => {
              press.current = { timer: null, fired: true };
              navigator.vibrate?.(30);
              setFab(true);
              setTarget("");
              setSelected(new Set(canPick(p) ? [p.id] : []));
            }, 500);
          },
          onPointerUp: endPress,
          onPointerCancel: endPress,
          onPointerLeave: endPress,
          onContextMenu: (e: React.MouseEvent) => {
            if (press.current.timer || press.current.fired) e.preventDefault();
          },
          style: { WebkitTouchCallout: "none" } as React.CSSProperties,
        })}
        onClickCapture={(e) => {
          // The tap that ends a long press doesn't also open the part.
          if (!press.current.fired) return;
          press.current.fired = false;
          e.stopPropagation();
          e.preventDefault();
        }}
        className={fab && !pickable ? "opacity-40" : undefined}
      >
        <PartCard
          part={p}
          save={(c) => save([p.id], c)}
          showSystem
          fabCounter
          fabStatusEditable={!!inBatch}
          style={fabTint(p)}
          selected={selected.has(p.id)}
          onToggleSelect={pickable ? () => toggle(p.id) : undefined}
          thumbBadge={
            inherit && work && (
              <button
                type="button"
                onClick={() => save([p.id], inherit)}
                className="press flex h-7 w-7 animate-pulse items-center justify-center rounded-full border border-amber-300 bg-amber-400 text-slate-950 shadow-[0_0_12px_3px_rgba(245,158,11,0.65)] hover:animate-none active:scale-[0.98]"
                aria-label={`Give ${partTitle(p)} the batch's machine and material`}
                title={`No ${[!p.material && "material", !machinesOf(p).length && "machine"].filter(Boolean).join(" or ")}: take the batch's`}
              >
                <Icon name="spark" className="h-4 w-4" />
              </button>
            )
          }
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
      draggable={!fab && work}
      memberNames={memberNames}
      me={me}
      onDropParts={fab || !work ? undefined : (load) => run(() => moveToFabBatch(b.id, load.ids, load.batch, batchStatus(b.members)))}
    />
  );
  const machinesWithParts = MACHINES.filter((m) => counts.byMachine.has(m.id));
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
          <MachineBox href={machineHref(null)} name="All machines" count={counts.total} active={!machine} />
          {machinesWithParts.map((m) => (
            <MachineBox key={m.id} href={machineHref(m.id)} name={m.name} count={counts.byMachine.get(m.id)!} active={machine === m.id} />
          ))}
          <MaterialBoxes counts={counts.byMaterial} active={mat} />
          <button
            onClick={() => setMine((m) => !m)}
            aria-pressed={mine}
            className={`press ml-auto self-center ${mine ? "btn-primary" : "btn"}`}
          >
            My batches
          </button>
          {work && <button
            onClick={() => startFab(!fab)}
            aria-pressed={fab}
            className={`press self-center rounded-xl px-7 py-3 text-lg font-bold shadow-lg transition-colors ${
              fab ? "border border-line-strong bg-surface text-fg" : "bg-amber-400 text-slate-950 shadow-amber-400/40 hover:bg-amber-300"
            }`}
          >
            {fab ? "Cancel" : "＋ Fab"}
          </button>}
        </div>

        {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}

        {view.post.length > 0 && (
          <div id="post-process" className="scroll-mt-20 rounded-xl border p-3" style={{ borderColor: "color-mix(in srgb, #f302f7 40%, transparent)", backgroundColor: "color-mix(in srgb, #f302f7 4%, transparent)" }}>
            <Section title="To Post Process" count={view.post.reduce((n, b) => n + b.post.filter((p) => !postChecked.has(p.id)).length, 0)}>
              {view.post.map((b) => (
                <BatchCard
                  key={b.id}
                  batch={b}
                  members={b.post}
                  save={save}
                  draggable={false}
                  memberNames={memberNames}
                  me={me}
                  card={(p) => (
                    <PartCard
                      key={p.id}
                      part={p}
                      save={(c) => save([p.id], c)}
                      showSystem
                      checked={postChecked.has(p.id)}
                      onCheck={() => checkPost(p)}
                      checkFrom={POST_PROCESSING}
                      checkTo={FINISHED_STATUS}
                      post={{ done: p.postDone, onChange: (n) => countPost(p, n) }}
                    />
                  )}
                />
              ))}
            </Section>
          </div>
        )}
        <Section title="Released" count={view.ready.length} empty="No parts are waiting to be made." onDropParts={fab || !work ? undefined : drop("ready")}>
          {view.ready.map((p) => card(p))}
        </Section>
        <Section
          title="Ready to Fab"
          count={view.batches.readyToFab.length}
          empty="Drag a Released part here, or use ＋ Fab, to make a batch."
          onDropParts={fab || !work ? undefined : drop("readyToFab")}
        >
          {view.batches.readyToFab.map(batchCard)}
        </Section>
        <Section
          title="In process"
          count={view.batches.inProcess.length + view.inProcess.length}
          empty="Nothing is being made right now."
          onDropParts={fab || !work ? undefined : drop("inProcess")}
        >
          {view.batches.inProcess.map(batchCard)}
          {view.inProcess.map((p) => card(p))}
        </Section>
        <Section
          title="Finished"
          count={view.batches.finished.length + view.finished.length}
          empty="Parts land here once all of them are made."
          onDropParts={fab || !work ? undefined : drop("finished")}
        >
          {view.batches.finished.map(batchCard)}
          {view.finished.map((p) => card(p))}
        </Section>
        {machine && view.other.length > 0 && (
          <Section title={`Other parts on ${getMachine(machine)?.name ?? "this machine"}`} count={view.other.length} small defaultOpen={false}>
            {view.other.map((p) => card(p))}
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
              <select
                className="input w-auto py-1"
                value={targetBatch?.id ?? ""}
                onChange={(e) => setTarget(e.target.value)}
                aria-label="Batch to add to"
              >
                <option value="">New batch</option>
                {targetOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              {targetBatch ? (
                targetBatch.machine && <span className="rounded-full bg-raised px-2.5 py-1 text-xs font-semibold">{getMachine(targetBatch.machine)?.name}</span>
              ) : machine ? (
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
              {!targetBatch && (
                <input
                  className="input w-40 py-1 font-mono tabular-nums sm:w-44"
                  value={batchName ?? defaultBatchName}
                  onChange={(e) => setBatchName(e.target.value)}
                  placeholder={defaultBatchName || "Batch name"}
                  aria-label="Name of the new batch"
                  maxLength={80}
                />
              )}
              <button
                className="btn-primary active:scale-[0.98]"
                disabled={pending || selected.size === 0 || (!targetBatch && !fabMachine)}
                onClick={submitFab}
              >
                {targetBatch ? `✓ Add to ${targetBatch.name}` : "✓ Create batch"}
              </button>
              <button className="btn active:scale-[0.98]" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
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

// One filter box per material with parts in the queue (on the machine picked), in the machine
// boxes' row (it wraps when there are many); ?mat= keeps the pick and a second click clears it.
function MaterialBoxes({ counts, active }: { counts: Map<string, number>; active: string | null }) {
  const colors = useMaterialColors();
  const materials = useMaterials();
  const all = materials.flatMap((g) => g.items.map((i) => i.name));
  const order = (m: string) => (m === NO_MATERIAL_KEY ? Infinity : all.indexOf(m) === -1 ? all.length : all.indexOf(m));
  const keys = [...counts.keys()].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  if (keys.length < 2 && !active) return null;
  return keys.map((m) => {
    const selected = active === m;
    const none = m === NO_MATERIAL_KEY;
    return (
      <button
        key={m}
        type="button"
        onClick={() => pushQuery({ mat: selected ? null : m })}
        data-selected={selected}
        aria-pressed={selected}
        className="card-interactive group flex h-12 shrink-0 items-center gap-2.5 self-center overflow-hidden pr-3 text-left active:scale-[0.98]"
      >
        <span className="relative flex h-full w-12 shrink-0 items-center justify-center bg-gradient-to-br from-sky-500/25 via-raised to-amber-400/20">
          <span
            className="h-6 w-6 rounded-md border border-white/20 shadow-sm transition-transform duration-150 group-hover:scale-[1.03]"
            style={{ backgroundColor: materialColor(none ? null : m, colors) }}
          />
        </span>
        <span className="min-w-0">
          <span className="block text-xs leading-tight font-bold whitespace-nowrap text-fg">{none ? "No material" : m.replace(/-T6$/, "")}</span>
          <span className="block font-mono text-[11px] text-subtle tabular-nums">{counts.get(m)}</span>
        </span>
      </button>
    );
  });
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
  const [openBatch, setOpenBatch] = useState<string | null>(null);
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
        <OpenBatchContext.Provider value={{ id: openBatch, set: setOpenBatch }}>
          <div className="card-grid" style={{ "--card-min": small ? "150px" : "200px" } as React.CSSProperties}>{children}</div>
        </OpenBatchContext.Provider>
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

// One open batch per section: opening a batch closes the one that was open.
const OpenBatchContext = createContext<{ id: string | null; set: (id: string | null) => void } | null>(null);

// How wide an open batch is: as many of the section grid's columns as it has parts, at least two
// so its header has room, never more than the grid has. The grid places it (span only): in the
// slot it had when closed if it fits there, else at the start of the next row.
type Place = { span: number; colWidth: number };
function measurePlace(el: HTMLElement | null, parts: number): Place | null {
  const grid = el?.parentElement;
  if (!el || !grid) return null;
  const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean);
  const colWidth = parseFloat(cols[0]) || 0;
  return { span: Math.max(1, Math.min(cols.length, Math.max(parts, 2))), colWidth };
}

// Runs a layout change as a short view transition where the browser has them, so the eye can
// follow a batch as it opens or closes. The change does its own flushSync.
function withTransition(change: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(change);
  else change();
}

// A fab batch: a collage of its parts, who makes it (on top of the collage; glowing when it's
// you), its machine and material, one status for all of them (named as the machine calls it),
// download all (on a closed batch only until it has G-code) and its G-code. Clicking the card opens it in place, with
// each part's own status; cards dropped on it join it. Rename and delete are in Edit mode.
function BatchCard({
  batch,
  members,
  save,
  card,
  draggable,
  memberNames,
  me,
  onDropParts,
}: {
  batch: Batch;
  members: CardPart[];
  save: (ids: string[], changes: PartChanges) => void;
  card: (p: CardPart, inBatch?: { batch: Batch; members: CardPart[] }) => React.ReactNode;
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
  const [place, setPlace] = useState<Place | null>(null);
  const transitionName = `batch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const toggle = () => {
    const next = !open;
    withTransition(() => {
      // Close the section's other open batch first, so this one is measured in a settled grid.
      if (next && section?.id) flushSync(() => section.set(null));
      const nextPlace = next ? measurePlace(ref.current, members.length) : null;
      flushSync(() => {
        setPlace(nextPlace);
        setOpen(next);
      });
    });
  };
  useLayoutEffect(() => {
    const grid = ref.current?.parentElement;
    if (!open || !grid) return;
    const observer = new ResizeObserver(() => setPlace(measurePlace(ref.current, members.length)));
    observer.observe(grid);
    return () => observer.disconnect();
  }, [open, members.length]);
  const wide = open && (place?.span ?? 1) >= 2;
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
      onClick={toggle}
      style={{
        ...(stage === "finished" || isFabFinished(lowest) ? tint(FINISHED_COLOR) : statusTint(computeStatus(lowest))),
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
            <Popover locked={!edit || mode === "cad"} trigger={<StatusPill status={shared ?? "Mixed"} label={shared ? label(shared) : undefined} size="md" />}>
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
            )}
            {open && (
              <button
                className="press flex items-center gap-1 rounded-full border border-line-strong bg-surface px-2.5 py-1 text-xs font-bold text-fg-2 transition-colors duration-150 hover:border-sky-400/40 hover:text-sky-500 active:scale-[0.98]"
                onClick={() => setLayoutOpen(true)}
                title="Lay the parts flat and nest them on the smallest plate on the shelf"
              >
                <Icon name="layers" className="h-3.5 w-3.5" />
                Auto Layout
              </button>
            )}
            {layoutOpen &&
              createPortal(
                // The window sits outside the card in the page, but React still hands its clicks to the card.
                <div onClick={stop} onDoubleClick={stop}>
                  <BatchLayoutDialog groupId={batch.id} name={batch.name} open onClose={() => setLayoutOpen(false)} />
                </div>,
                document.body,
              )}
            <span className="ml-auto flex items-center gap-1.5">
              {downloads.length > 0 && !(batch.gcode && !open) && (
                <button className="overlay-btn" onClick={() => void downloadAll(downloads)} aria-label={`Download ${downloads.length} files`} title={`Download ${downloads.length} files`}>
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
async function downloadAll(urls: string[]) {
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
