"use client";

import Link from "next/link";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { MACHINES, getMachine } from "@/config/machines";
import { DONE_STATUSES, type StatusName } from "@/config/statuses";
import { createFabBatch, deleteGroup, removeFromGroup, updateGroup } from "@/app/(app)/groups/actions";
import { updatePart, updateParts } from "@/app/(app)/parts-actions";
import { BomProvider, type InventoryName } from "@/components/bom/BomContext";
import { matchesTopBar } from "@/components/bom/filter";
import { OptionList, Popover } from "@/components/bom/Popover";
import { STATUS_OPTIONS } from "@/components/bom/options";
import { PartCard, cadFormat } from "@/components/bom/PartCard";
import { partTitle, type CardPart } from "@/components/bom/types";
import { useFilters } from "@/components/shell/FilterContext";
import { useEditMode } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
import { IN_PROCESS_STATUS, READY_STATUS, fabStage, machinesOf } from "@/lib/fab";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { computeStatus } from "@/lib/status";

export type Batch = { id: string; name: string; machine: string | null };

const isDone = (p: CardPart) => (DONE_STATUSES as string[]).includes(computeStatus(p));

// Dragging cards or batches between sections sets their status.
const DRAG_TYPE = "application/x-orbit-parts";
const SECTION_STATUS = { ready: READY_STATUS, inProcess: IN_PROCESS_STATUS } as const;
type Stage = keyof typeof SECTION_STATUS;

// A batch sits in Ready to fab while any part still waits there, then in In process.
const batchStage = (members: CardPart[]): Stage =>
  members.some((p) => fabStage(p) === "ready") || !members.some((p) => fabStage(p) === "inProcess") ? "ready" : "inProcess";

const common = (lists: string[][]) => (lists.length ? lists.reduce((acc, l) => acc.filter((m) => l.includes(m))) : []);

// To Fab: machine boxes, then Ready to fab and In process, each with its fab batches first (and,
// for one machine, its other parts). The Fab button picks cards of one material on one machine
// and turns them into a batch.
export function FabView({
  parts,
  batches,
  machine,
  robotId,
  inventory,
  isAdmin,
}: {
  parts: CardPart[];
  batches: Batch[];
  machine?: string;
  robotId: string;
  inventory: InventoryName[];
  isAdmin: boolean;
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

  const { filters } = useFilters();
  const [fab, setFab] = useState(false);
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
    // A batch stays on To Fab until all its parts are done.
    const shownBatches = batches
      .map((b) => ({ ...b, members: optimistic.filter((p) => p.groups.some((g) => g.id === b.id)) }))
      .filter(
        (b) =>
          b.members.some((p) => !isDone(p)) &&
          (machine ? (b.machine ? b.machine === machine : b.members.some(onMachine)) : true) &&
          b.members.some((p) => matchesTopBar(p, filters)),
      );
    const batched = new Set(shownBatches.flatMap((b) => b.members.map((p) => p.id)));
    const loose = optimistic.filter((p) => !batched.has(p.id) && onMachine(p) && matchesTopBar(p, filters));
    return {
      batches: { ready: shownBatches.filter((b) => batchStage(b.members) === "ready"), inProcess: shownBatches.filter((b) => batchStage(b.members) === "inProcess") },
      ready: loose.filter((p) => fabStage(p) === "ready"),
      inProcess: loose.filter((p) => fabStage(p) === "inProcess"),
      other: machine ? loose.filter((p) => !fabStage(p)) : [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMachine only reads `machine`
  }, [optimistic, batches, filters, machine]);

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
        onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, JSON.stringify([p.id]))}
        className={fab && !pickable ? "opacity-40" : undefined}
      >
        <PartCard part={p} save={(c) => save([p.id], c)} showSystem selected={selected.has(p.id)} onToggleSelect={pickable ? () => toggle(p.id) : undefined} />
      </div>
    );
  };
  const batchCard = (b: Batch & { members: CardPart[] }) => <BatchCard key={b.id} batch={b} members={b.members} save={save} card={card} draggable={!fab} />;
  const machinesWithParts = MACHINES.filter((m) => counts.byMachine.has(m.id));
  const base = `/robots/${robotId}/fab`;
  const drop = (stage: Stage) => (ids: string[]) => save(ids, { status: SECTION_STATUS[stage] });

  return (
    <BomProvider value={{ inventory, isAdmin, robotId }}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-stretch gap-2">
          <MachineBox href={base} name="All machines" count={counts.total} active={!machine} />
          {machinesWithParts.map((m) => (
            <MachineBox key={m.id} href={`${base}?machine=${m.id}`} name={m.name} count={counts.byMachine.get(m.id)!} active={machine === m.id} />
          ))}
          <button
            onClick={() => {
              setFab((f) => !f);
              setSelected(new Set());
            }}
            aria-pressed={fab}
            className={`press ml-auto self-center rounded-xl px-7 py-3 text-lg font-bold shadow-lg transition-colors ${
              fab ? "border border-line-strong bg-surface text-fg" : "bg-amber-400 text-slate-950 shadow-amber-400/40 hover:bg-amber-300"
            }`}
          >
            {fab ? "Cancel" : "＋ Fab"}
          </button>
        </div>

        {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}

        <Section
          title="Ready to fab"
          count={view.batches.ready.length + view.ready.length}
          empty="No parts are waiting to be made."
          onDropParts={fab ? undefined : drop("ready")}
        >
          {view.batches.ready.map(batchCard)}
          {view.ready.map(card)}
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
        {machine && view.other.length > 0 && (
          <Section title={`Other parts on ${getMachine(machine)?.name ?? "this machine"}`} count={view.other.length}>
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

function MachineBox({ href, name, count, active }: { href: string; name: string; count: number; active: boolean }) {
  return (
    <Link
      href={href}
      data-selected={active}
      className="card-interactive flex min-w-32 flex-col px-4 py-2.5"
    >
      <span className="display text-2xl text-accent tabular-nums">{count}</span>
      <span className="truncate text-xs font-medium text-fg-2">{name}</span>
    </Link>
  );
}

function Section({
  title,
  count,
  empty,
  onDropParts,
  children,
}: {
  title: string;
  count: number;
  empty?: string;
  onDropParts?: (ids: string[]) => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
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
      const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || "[]") as string[];
      if (ids.length) {
        e.preventDefault();
        onDropParts(ids);
      }
    },
  };
  return (
    <section {...dropProps} className={`-m-2 space-y-3 rounded-xl p-2 transition-colors ${over ? "bg-accent/5 ring-2 ring-accent/40" : ""}`}>
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-semibold text-fg-2 tabular-nums">{count}</span>
        <div className="h-px flex-1 bg-line" />
      </div>
      {count === 0 && empty ? (
        <p className={`text-sm text-subtle ${onDropParts ? "rounded-lg border border-dashed border-line py-6 text-center" : ""}`}>{empty}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">{children}</div>
      )}
    </section>
  );
}

// A fab batch: a collage of its parts, its machine and material, one status for all of them,
// download all, and the member cards when opened. Rename and delete are in Edit mode.
function BatchCard({
  batch,
  members,
  save,
  card,
  draggable,
}: {
  batch: Batch;
  members: CardPart[];
  save: (ids: string[], changes: PartChanges) => void;
  card: (p: CardPart) => React.ReactNode;
  draggable: boolean;
}) {
  const edit = useEditMode();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [, startTransition] = useTransition();
  const statuses = [...new Set(members.map((p) => computeStatus(p)))];
  const shared = statuses.length === 1 ? statuses[0] : null;
  const qty = members.reduce((n, p) => n + p.quantity, 0);
  const materials = [...new Set(members.map((p) => p.material ?? ""))];
  const material = materials.length === 1 ? materials[0] || "No material" : "Mixed materials";
  const machineName = batch.machine ? (getMachine(batch.machine)?.name ?? batch.machine) : null;
  const downloads = members.flatMap((p) => {
    const f = cadFormat(p);
    return f ? [`/api/parts/${p.id}/export?format=${f}`] : [];
  });
  const rename = (name: string) => {
    setRenaming(false);
    if (name.trim() && name.trim() !== batch.name) startTransition(() => void updateGroup(batch.id, { name }));
  };

  return (
    <div
      draggable={draggable && !renaming}
      onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(members.filter((p) => !isDone(p)).map((p) => p.id)))}
      className={`card-interactive flex flex-col text-sm ${open ? "col-span-full" : ""}`}
    >
      <div className={open ? "flex flex-wrap gap-4 p-3" : "flex flex-col"}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? `Close ${batch.name}` : `Open ${batch.name}`}
          className={`thumb-well grid grid-cols-2 grid-rows-2 gap-px overflow-hidden ${open ? "aspect-[4/3] w-40 rounded-lg" : "aspect-[4/3] w-full"}`}
        >
          {members.slice(0, 4).map((p) => (
            <span key={p.id} className="flex items-center justify-center bg-well">
              {p.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links
                <img src={p.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain p-1.5" />
              ) : (
                <span className="px-1 text-center text-[10px] text-subtle">{partTitle(p)}</span>
              )}
            </span>
          ))}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
          <div className="min-w-0">
            {renaming ? (
              <input
                autoFocus
                defaultValue={batch.name}
                aria-label="Fab name"
                className="input py-1 text-base font-semibold"
                onBlur={(e) => rename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") rename(e.currentTarget.value);
                  if (e.key === "Escape") setRenaming(false);
                }}
              />
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="display truncate text-xl text-accent">{batch.name}</span>
                {edit && (
                  <button className="press shrink-0 text-xs text-subtle hover:text-accent" onClick={() => setRenaming(true)}>
                    Rename
                  </button>
                )}
              </div>
            )}
            <div className="truncate text-xs font-medium text-fg-2">
              {material}
              {machineName && ` · ${machineName}`}
            </div>
            <div className="text-xs text-subtle tabular-nums">
              {members.length} parts, {qty} pcs
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Popover trigger={<StatusPill status={shared ?? "Mixed"} size="md" />}>
              {(close) => (
                <OptionList
                  options={STATUS_OPTIONS}
                  value={shared}
                  placeholder="Set status for all…"
                  onPick={(v) => {
                    if (v) save(members.map((p) => p.id), { status: v as StatusName });
                    close();
                  }}
                />
              )}
            </Popover>
            {downloads.length > 0 && (
              <button className="overlay-btn" onClick={() => downloadAll(downloads)} aria-label={`Download ${downloads.length} files`} title={`Download ${downloads.length} files`}>
                <Icon name="download" />
              </button>
            )}
            <button className="press ml-auto text-xs font-medium text-accent hover:underline" onClick={() => setOpen((o) => !o)}>
              {open ? "Close" : "Open"}
            </button>
          </div>
          {edit && (
            <button
              className="press self-start text-xs text-subtle hover:text-rose-700"
              onClick={() => {
                if (confirm(`Delete ${batch.name}? Its parts stay on the BOM with their status.`)) startTransition(() => void deleteGroup(batch.id));
              }}
            >
              Delete fab
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 border-t border-line p-3">
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
