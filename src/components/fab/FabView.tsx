"use client";

import Link from "next/link";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { MACHINES, getMachine } from "@/config/machines";
import { DONE_STATUSES, type StatusName } from "@/config/statuses";
import { createFabBatch, deleteGroup, removeFromGroup } from "@/app/(app)/groups/actions";
import { updatePart, updateParts } from "@/app/(app)/parts-actions";
import { BomProvider, type InventoryName } from "@/components/bom/BomContext";
import { matchesTopBar } from "@/components/bom/filter";
import { OptionList, Popover } from "@/components/bom/Popover";
import { STATUS_OPTIONS } from "@/components/bom/options";
import { PartCard, cadFormat } from "@/components/bom/PartCard";
import { partTitle, type CardPart } from "@/components/bom/types";
import { useFilters } from "@/components/shell/FilterContext";
import { Icon } from "@/components/ui/Icon";
import { StatusPill } from "@/components/ui/StatusPill";
import { fabStage, machinesOf } from "@/lib/fab";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { computeStatus } from "@/lib/status";

export type Batch = { id: string; name: string };

const isDone = (p: CardPart) => (DONE_STATUSES as string[]).includes(computeStatus(p));

// To Fab: machine boxes, then FAB batches, parts in process and parts ready to fab (and, for one
// machine, its other parts). The FAB toggle picks cards and turns them into the next batch.
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
      .filter((b) => b.members.some((p) => !isDone(p)) && b.members.some(onMachine) && b.members.some((p) => matchesTopBar(p, filters)));
    const batched = new Set(shownBatches.flatMap((b) => b.members.map((p) => p.id)));
    const loose = optimistic.filter((p) => !batched.has(p.id) && onMachine(p) && matchesTopBar(p, filters));
    return {
      batches: shownBatches,
      inProcess: loose.filter((p) => fabStage(p) === "inProcess"),
      ready: loose.filter((p) => fabStage(p) === "ready"),
      other: machine ? loose.filter((p) => !fabStage(p)) : [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onMachine only reads `machine`
  }, [optimistic, batches, filters, machine]);

  const card = (p: CardPart) => (
    <PartCard key={p.id} part={p} save={(c) => save([p.id], c)} showSystem selected={selected.has(p.id)} onToggleSelect={fab ? () => toggle(p.id) : undefined} />
  );
  const machinesWithParts = MACHINES.filter((m) => counts.byMachine.has(m.id));
  const base = `/robots/${robotId}/fab`;

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
            className={`press ml-auto self-center ${fab ? "btn-primary" : "btn"}`}
          >
            {fab ? "Cancel FAB" : "FAB"}
          </button>
        </div>

        {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}

        {view.batches.length > 0 && (
          <Section title="FAB batches" count={view.batches.length}>
            {view.batches.map((b) => (
              <BatchCard key={b.id} batch={b} members={b.members} save={save} card={card} />
            ))}
          </Section>
        )}
        <Section title="In process" count={view.inProcess.length} empty="Nothing is being made right now.">
          {view.inProcess.map(card)}
        </Section>
        <Section title="Ready to fab" count={view.ready.length} empty="No parts are waiting to be made.">
          {view.ready.map(card)}
        </Section>
        {machine && view.other.length > 0 && (
          <Section title={`Other parts on ${getMachine(machine)?.name ?? "this machine"}`} count={view.other.length}>
            {view.other.map(card)}
          </Section>
        )}

        {fab && (
          <div className="sticky bottom-3 z-30 rounded-xl border border-line-strong bg-surface/95 p-3 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold tabular-nums">
                {selected.size} selected
              </span>
              <span className="text-subtle">Tap cards to add them to the batch.</span>
              <button
                className="btn-primary ml-auto"
                disabled={pending || selected.size === 0}
                onClick={() =>
                  startTransition(async () => {
                    const r = await createFabBatch(robotId, [...selected]);
                    setError(r.error ?? null);
                    if (!r.error) {
                      setFab(false);
                      setSelected(new Set());
                    }
                  })
                }
              >
                ✓ Create batch
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

function Section({ title, count, empty, children }: { title: string; count: number; empty?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="rounded-full bg-raised px-2 py-0.5 text-xs font-semibold text-fg-2 tabular-nums">{count}</span>
        <div className="h-px flex-1 bg-line" />
      </div>
      {count === 0 && empty ? (
        <p className="text-sm text-subtle">{empty}</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">{children}</div>
      )}
    </section>
  );
}

// A FAB batch: a collage of its parts, one status for all of them, download all, and the
// member cards when opened.
function BatchCard({
  batch,
  members,
  save,
  card,
}: {
  batch: Batch;
  members: CardPart[];
  save: (ids: string[], changes: PartChanges) => void;
  card: (p: CardPart) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const statuses = [...new Set(members.map((p) => computeStatus(p)))];
  const shared = statuses.length === 1 ? statuses[0] : null;
  const qty = members.reduce((n, p) => n + p.quantity, 0);
  const downloads = members.flatMap((p) => {
    const f = cadFormat(p);
    return f ? [`/api/parts/${p.id}/export?format=${f}`] : [];
  });

  return (
    <div className={`card-interactive flex flex-col text-sm ${open ? "col-span-full" : ""}`}>
      <div className={open ? "flex flex-wrap gap-4 p-3" : "flex flex-col"}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? `Close ${batch.name}` : `Open ${batch.name}`}
          className={`thumb-well grid grid-cols-2 grid-rows-2 gap-px overflow-hidden ${open ? "aspect-[4/3] w-40 rounded-lg" : "aspect-[4/3] w-full"}`}
        >
          {members.slice(0, 4).map((p) => (
            <span key={p.id} className="flex items-center justify-center bg-white">
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
          <div className="flex items-baseline gap-2">
            <span className="display text-xl text-accent">{batch.name}</span>
            <span className="text-xs text-subtle tabular-nums">
              {members.length} parts, {qty} pcs
            </span>
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
          {open && (
            <button
              className="self-start text-xs text-subtle hover:text-rose-700"
              onClick={() => {
                if (confirm(`Ungroup ${batch.name}? Its parts go back to the lists.`)) startTransition(() => void deleteGroup(batch.id));
              }}
            >
              Ungroup batch
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3 border-t border-line p-3">
          {members.map((p) => (
            <div key={p.id} className="flex flex-col gap-1">
              {card(p)}
              <button
                className="self-start text-xs text-subtle hover:text-rose-700"
                onClick={() => startTransition(() => void removeFromGroup(batch.id, p.id))}
              >
                Remove from {batch.name}
              </button>
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
