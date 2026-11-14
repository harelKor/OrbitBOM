"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from "react";
import { MACHINES, getMachine } from "@/config/machines";
import { createFabBatch, moveToFabBatch, removeFromGroup } from "@/app/(app)/groups/actions";
import { updatePart, updateParts } from "@/app/(app)/parts-actions";
import { BomProvider, type InventoryName } from "@/components/bom/BomContext";
import { matchesTopBar } from "@/components/bom/filter";
import { PartCard } from "@/components/bom/PartCard";
import { partTitle, type CardPart } from "@/components/bom/types";
import { useFilters } from "@/components/shell/FilterContext";
import { useCan } from "@/components/shell/ModeContext";
import { Chevron } from "@/components/ui/Chevron";
import { Icon } from "@/components/ui/Icon";
import { useEscape } from "@/components/ui/useEscape";
import { Segmented } from "@/components/ui/Segmented";
import { useStoredChoice } from "@/components/ui/useStoredChoice";
import { FINISHED_STATUS, fabStage, machinesOf } from "@/lib/fab";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { statusMachine } from "@/lib/status";
import { FabPartListRow } from "./FabListRow";
import { useArrivalHalo } from "@/components/shell/Arrivals";
import { arrivalPage } from "@/lib/seen";

// Cards (the default) or List: horizontal rows, batches folding open below their row.
const LAYOUTS = ["cards", "list"] as const;

import { type FabLayout, DRAG_TYPE, SECTION_STATUS, partStage, batchStage, POST_PROCESSING, isPostProcessing, fabTint, common, materialKeyOf, inheritFromBatch, fabState, batchStatus, type Batch, type Stage, type DragLoad } from "./fabModel";
import { MachineBox, MobileMachines, MaterialFilters } from "./MachineFilters";
import { OpenBatchContext, BatchCard } from "./BatchCard";

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
  seenAt = null,
}: {
  parts: CardPart[];
  batches: Batch[];
  robotId: string;
  inventory: InventoryName[];
  isAdmin: boolean;
  memberNames: string[];
  me: string;
  seenAt?: string | null; // when this member last opened Shop Fab, before this visit (src/lib/seen.ts)
}) {
  // Any team works the To Fab page; without a team (read only) nothing moves or changes.
  const work = useCan("work");
  const locked = useMemo(() => parts.map(fabState), [parts]);
  // A change shows at once; `to` / `from` also move the parts between batches while the save runs.
  type Shown = { ids: string[]; changes: PartChanges; to?: CardPart["groups"][number]; from?: string | null };
  const [optimistic, addOptimistic] = useOptimistic(locked, (state, { ids, changes, to, from }: Shown) =>
    state.map((p) => {
      if (!ids.includes(p.id)) return p;
      const groups = p.groups.filter((g) => g.id !== from && g.id !== to?.id);
      return { ...p, ...planPartUpdate(p, changes, "ui").set, groups: to ? [...groups, to] : groups };
    }),
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
  // Parts that arrived (Released, In process, Post Processing) since this member's last visit
  // glow until the first press anywhere (Harel, 2026-11-05).
  const halo = useArrivalHalo(seenAt, me);
  const arrived = (p: CardPart) => halo(p) && arrivalPage(p, robotId)?.page === `fab:${robotId}`;
  const [layout, setLayout] = useStoredChoice("orbit-fab-view", LAYOUTS, "cards");
  const [fab, setFab] = useState(false);
  const searchParams = useSearchParams();
  // Only the batches made by the signed-in member; the dashboard's My Batches box opens it on (?mine=1).
  const [mine, setMine] = useState(() => searchParams.get("mine") === "1");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pickedMachine, setPickedMachine] = useState("");
  const [target, setTarget] = useState(""); // the batch the Fab button adds to ("" = a new one)
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
  };
  useEscape(fab, () => startFab(false));
  // Batches show no name (BatchCard): the Fab bar tells them apart by machine, material and day.
  const batchLabel = (b: Batch & { members: CardPart[] }) =>
    [b.machine && (getMachine(b.machine)?.name ?? b.machine), batchMaterial(b) || "No material", new Date(b.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })].filter(Boolean).join(" · ");
  const submitFab = () =>
    startTransition(async () => {
      let r: { error?: string };
      if (targetBatch) r = await moveToFabBatch(targetBatch.id, [...selected], null, batchStatus(targetBatch.members));
      else r = await createFabBatch(robotId, [...selected], fabMachine!);
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
    const spark = inherit && work && (
      <button
        type="button"
        onClick={() => save([p.id], inherit)}
        className="press flex h-7 w-7 animate-pulse items-center justify-center rounded-full border border-amber-300 bg-amber-400 text-slate-950 shadow-[0_0_12px_3px_rgba(245,158,11,0.65)] hover:animate-none active:scale-[0.98]"
        aria-label={`Give ${partTitle(p)} the batch's machine and material`}
        title={`No ${[!p.material && "material", !machinesOf(p).length && "machine"].filter(Boolean).join(" or ")}: take the batch's`}
      >
        <Icon name="spark" className="h-4 w-4" />
      </button>
    );
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
        data-arrival={arrived(p) ? "" : undefined}
      >
        {layout === "list" ? (
          <FabPartListRow
            part={p}
            save={(c) => save([p.id], c)}
            editStatus={!!inBatch}
            style={fabTint(p)}
            selected={selected.has(p.id)}
            onToggleSelect={pickable ? () => toggle(p.id) : undefined}
            lead={spark}
          />
        ) : (
          <PartCard
            part={p}
            save={(c) => save([p.id], c)}
            fabCounter
            fabStatusEditable={!!inBatch}
            style={fabTint(p)}
            selected={selected.has(p.id)}
            onToggleSelect={pickable ? () => toggle(p.id) : undefined}
            thumbBadge={spark}
          />
        )}
      </div>
    );
  };
  // Parts dropped on a batch show in it straight away; a failed save puts them back.
  const moveInto = (b: Batch & { members: CardPart[] }, load: DragLoad) => {
    const status = batchStatus(b.members);
    setError(null);
    startTransition(async () => {
      const color = b.members.flatMap((p) => p.groups).find((g) => g.id === b.id)?.color ?? null;
      addOptimistic({ ids: load.ids, changes: status ? { status } : {}, to: { id: b.id, name: b.name, color }, from: load.batch });
      const r = await moveToFabBatch(b.id, load.ids, load.batch, status);
      if (r.error) setError(r.error);
    });
  };
  const batchCard = (b: Batch & { members: CardPart[] }) => (
    <BatchCard
      key={b.id}
      batch={b}
      members={b.members}
      save={save}
      card={card}
      layout={layout}
      draggable={!fab && work}
      memberNames={memberNames}
      me={me}
      onDropParts={fab || !work ? undefined : (load) => moveInto(b, load)}
      arrival={b.members.some(arrived)}
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
      if (load.batch) {
        // Out of its batch and back to Released, both on screen at once.
        const from = load.batch;
        setError(null);
        startTransition(async () => {
          addOptimistic({ ids: load.ids, changes: { status }, from });
          await removeFromGroup(from, load.ids[0]);
          const r = load.ids.length === 1 ? await updatePart(load.ids[0], { status }) : await updateParts(load.ids, { status });
          if (r.error) setError(r.error);
        });
      } else if (load.from !== "ready") save(load.ids, { status });
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
          <MachineBox href={machineHref(null)} name="All machines" count={counts.total} active={!machine} className="hidden sm:flex" />
          {machinesWithParts.map((m) => (
            <MachineBox key={m.id} href={machineHref(m.id)} name={m.name} count={counts.byMachine.get(m.id)!} active={machine === m.id} className="hidden sm:flex" />
          ))}
          <MobileMachines
            total={counts.total}
            machines={machinesWithParts.map((m) => ({ id: m.id, name: m.name, count: counts.byMachine.get(m.id)! }))}
            active={machine ? (getMachine(machine)?.name ?? machine) : null}
            activeId={machine ?? null}
            href={machineHref}
          />
          <MaterialFilters counts={counts.byMaterial} active={mat} />
          <div className="ml-auto self-center">
            <Segmented
              label="Shop Fab view"
              value={layout}
              onChange={setLayout}
              options={[
                { value: "cards", label: "Cards" },
                { value: "list", label: "List" },
              ]}
            />
          </div>
          <button
            onClick={() => setMine((m) => !m)}
            aria-pressed={mine}
            className={`press self-center ${mine ? "btn-primary" : "btn"}`}
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
            <Section layout={layout} title="To Post Process" count={view.post.reduce((n, b) => n + b.post.filter((p) => !postChecked.has(p.id)).length, 0)}>
              {view.post.map((b) => (
                <BatchCard
                  key={b.id}
                  batch={b}
                  members={b.post}
                  save={save}
                  draggable={false}
                  layout={layout}
                  memberNames={memberNames}
                  me={me}
                  card={(p) =>
                    layout === "list" ? (
                      <FabPartListRow
                        key={p.id}
                        part={p}
                        save={(c) => save([p.id], c)}
                        checked={postChecked.has(p.id)}
                        onCheck={() => checkPost(p)}
                        checkFrom={POST_PROCESSING}
                        checkTo={FINISHED_STATUS}
                        post={{ done: p.postDone, onChange: (n) => countPost(p, n) }}
                      />
                    ) : (
                    <PartCard
                      key={p.id}
                      part={p}
                      save={(c) => save([p.id], c)}
                      checked={postChecked.has(p.id)}
                      onCheck={() => checkPost(p)}
                      checkFrom={POST_PROCESSING}
                      checkTo={FINISHED_STATUS}
                      post={{ done: p.postDone, onChange: (n) => countPost(p, n) }}
                    />
                    )
                  }
                />
              ))}
            </Section>
          </div>
        )}
        <Section layout={layout} title="Released" count={view.ready.length} empty="No parts are waiting to be made." onDropParts={fab || !work ? undefined : drop("ready")}>
          {view.ready.map((p) => card(p))}
        </Section>
        <Section layout={layout}
          title="Ready to Fab"
          count={view.batches.readyToFab.length}
          empty="Drag a Released part here, or use ＋ Fab, to make a batch."
          onDropParts={fab || !work ? undefined : drop("readyToFab")}
        >
          {view.batches.readyToFab.map(batchCard)}
        </Section>
        <Section layout={layout}
          title="In process"
          count={view.batches.inProcess.length + view.inProcess.length}
          empty="Nothing is being made right now."
          onDropParts={fab || !work ? undefined : drop("inProcess")}
        >
          {view.batches.inProcess.map(batchCard)}
          {view.inProcess.map((p) => card(p))}
        </Section>
        <Section layout={layout}
          title="Finished"
          count={view.batches.finished.length + view.finished.length}
          empty="Parts land here once all of them are made."
          onDropParts={fab || !work ? undefined : drop("finished")}
        >
          {view.batches.finished.map(batchCard)}
          {view.finished.map((p) => card(p))}
        </Section>
        {machine && view.other.length > 0 && (
          <Section layout={layout} title={`Other parts on ${getMachine(machine)?.name ?? "this machine"}`} count={view.other.length} small defaultOpen={false}>
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
                    {batchLabel(b)}
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
              <button
                className="btn-primary active:scale-[0.98]"
                disabled={pending || selected.size === 0 || (!targetBatch && !fabMachine)}
                onClick={submitFab}
              >
                {targetBatch ? "✓ Add to batch" : "✓ Create batch"}
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
      <h1 className="display text-3xl text-accent">Shop Fab{machine && ` · ${getMachine(machine)!.name}`}</h1>
    </div>
  );
}

function Section({
  title,
  count,
  layout = "cards",
  empty,
  onDropParts,
  small = false,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  layout?: FabLayout;
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
          {layout === "list" ? (
            <div className="list-stack fab-grid">{children}</div>
          ) : (
            <div className="card-grid fab-grid" style={{ "--card-min": small ? "150px" : "220px" } as React.CSSProperties}>{children}</div>
          )}
        </OpenBatchContext.Provider>
      )}
    </section>
  );
}
