"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { createFabBatch, moveToFabBatch } from "@/app/(app)/groups/actions";
import { updatePart, updateParts } from "@/app/(app)/parts-actions";
import { BomProvider, type InventoryName } from "@/components/bom/BomContext";
import { matchesTopBar } from "@/components/bom/filter";
import { PartCard } from "@/components/bom/PartCard";
import { type CardPart } from "@/components/bom/types";
import { BatchCard, OpenBatchContext } from "@/components/fab/BatchCard";
import { batchStatus, fabState, type Batch } from "@/components/fab/fabModel";
import { useFilters } from "@/components/shell/FilterContext";
import { useCan } from "@/components/shell/ModeContext";
import { Chevron } from "@/components/ui/Chevron";
import { statusTint } from "@/components/ui/statusTint";
import { useEscape } from "@/components/ui/useEscape";
import type { FabArea } from "@/config/machines";
import { AREA_READY, FACTORY_IN_STOCK_DAYS } from "@/lib/fab";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { computeStatus } from "@/lib/status";
import { FactoryStatusButton } from "./FactoryStatusButton";
import { useArrivalHalo } from "@/components/shell/Arrivals";
import { arrivalPage } from "@/lib/seen";
import { Notice } from "@/components/ui/Notice";

const IN_STOCK_MS = FACTORY_IN_STOCK_DAYS * 24 * 60 * 60 * 1000;
const inStock = (p: CardPart) => computeStatus(p) === "In Stock";
// Released cards are plain, as on Shop Fab; the rest take their status's colour.
const tintOf = (p: CardPart) => (computeStatus(p) === "Released" ? {} : statusTint(computeStatus(p)));

// One factory's or team 3D printer's page (Harel, 2026-11-04): Released (its loose Released parts,
// a printer's Reproduction ones too, each with the big status button), Packs (always open: packs
// not yet all In Stock, then loose parts already being made) and In Stock (folded: packs and parts
// that got there in the last month). ＋ Pack picks Released parts and makes them a pack, or adds
// them to an open one, like Shop Fab's ＋ Fab.
export function FactoryView({
  area = "factory",
  factory,
  seenAt = null,
  byMaterial = false,
  parts,
  packs,
  robotId,
  inventory,
  isAdmin,
  me,
}: {
  area?: FabArea;
  factory: string; // the factory's or printer's machine id
  seenAt?: string | null; // when this member last opened the page, before this visit (src/lib/seen.ts)
  byMaterial?: boolean; // Zivudim: Released parts are packed by material by themselves (lib/factory/autoPack.ts)
  parts: CardPart[];
  packs: Batch[];
  robotId: string;
  inventory: InventoryName[];
  isAdmin: boolean;
  me: string;
}) {
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
  const { filters } = useFilters();
  // Parts that arrived since this member's last visit glow until the first press (Harel, 2026-11-05).
  const halo = useArrivalHalo(seenAt, me);
  const page = `${area}:${robotId}:${factory}`;
  const arrived = (p: CardPart) => halo(p) && arrivalPage(p, robotId)?.page === page;
  const [now] = useState(() => Date.now());
  const recent = (at: Date | string | number | null | undefined) => !!at && now - new Date(at).getTime() < IN_STOCK_MS;

  const view = useMemo(() => {
    const all = packs.map((b) => ({ ...b, members: optimistic.filter((p) => p.groups.some((g) => g.id === b.id)) })).filter((b) => b.members.length > 0);
    const packed = new Set(all.flatMap((b) => b.members.map((p) => p.id)));
    const shown = optimistic.filter((p) => matchesTopBar(p, filters));
    const loose = shown.filter((p) => !packed.has(p.id));
    // A pack is In Stock once every part is; it shows there for a month after its last one arrived.
    const done = all.filter((b) => b.members.every(inStock));
    const lastIn = (b: (typeof all)[number]) => b.members.reduce<number>((t, p) => Math.max(t, p.fabFinishedAt ? new Date(p.fabFinishedAt).getTime() : 0), 0);
    const visible = (b: (typeof all)[number]) => b.members.some((p) => shown.includes(p));
    return {
      all,
      released: loose.filter((p) => AREA_READY[area].includes(computeStatus(p))),
      packs: all.filter((b) => !done.includes(b) && visible(b)),
      atFactory: loose.filter((p) => !["Not Started", "In Stock", ...AREA_READY[area]].includes(computeStatus(p))),
      inStockPacks: done.filter((b) => visible(b) && recent(lastIn(b) || null)),
      inStockParts: loose.filter((p) => inStock(p) && recent(p.fabFinishedAt)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recent only reads `now`
  }, [optimistic, packs, filters, area]);

  // ＋ Pack: pick loose Released parts, then make a new pack or add them to an open one.
  const [packing, setPacking] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(""); // "" = a new pack
  const startPack = (on: boolean) => {
    setPacking(on);
    setSelected(new Set());
    setTarget("");
  };
  useEscape(packing, () => startPack(false));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const targetPack = view.packs.find((b) => b.id === target) ?? null;
  const packLabel = (b: (typeof view.packs)[number]) =>
    `${new Date(b.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${b.members.length} part${b.members.length === 1 ? "" : "s"}`;
  const submitPack = () =>
    startTransition(async () => {
      const r = targetPack ? await moveToFabBatch(targetPack.id, [...selected], null, batchStatus(targetPack.members)) : await createFabBatch(robotId, [...selected], factory);
      setError(r.error ?? null);
      if (!r.error) startPack(false);
    });

  const card = (p: CardPart) => {
    const pickable = packing && view.released.includes(p);
    return (
      <div key={p.id} className={packing && !pickable ? "opacity-40" : undefined} data-arrival={arrived(p) ? "" : undefined}>
        <PartCard
          part={p}
          save={(c) => save([p.id], c)}
          style={tintOf(p)}
          selected={selected.has(p.id)}
          onToggleSelect={pickable ? () => toggle(p.id) : undefined}
          nameNote={byMaterial ? p.material || "No material" : undefined}
          statusButton={
            <FactoryStatusButton
              status={computeStatus(p)}
              area={area}
              machine={factory}
              part={p}
              onPick={(s, note) => save([p.id], { status: s as PartChanges["status"], ...(note !== undefined && { note }) })}
            />
          }
        />
      </div>
    );
  };
  // Zivudim's packs are named by their material: the parts' own, unless they differ.
  const packTitle = (b: (typeof view.all)[number]) => {
    const materials = [...new Set(b.members.map((p) => p.material || "No material"))];
    return materials.length === 1 ? materials[0] : b.name;
  };
  const packCard = (b: (typeof view.all)[number]) => (
    <BatchCard key={b.id} pack title={byMaterial ? packTitle(b) : undefined} batch={b} members={b.members} save={save} card={card} draggable={false} memberNames={[]} me={me} arrival={b.members.some(arrived)} />
  );

  return (
    <BomProvider value={{ inventory, isAdmin, robotId }}>
      <div className="space-y-6">
        {error && <Notice tone="error">Couldn&apos;t save: {error}</Notice>}

        {/* Zivudim packs by itself, so Released only shows for the moment before the page reloads. */}
        {(!byMaterial || view.released.length > 0) && <Section
          title="Released"
          count={view.released.length}
          empty="No parts are waiting to be packed."
          action={
            work && !byMaterial && (
              <button
                onClick={() => startPack(!packing)}
                aria-pressed={packing}
                className={`press rounded-xl px-7 py-3 text-lg font-bold shadow-lg transition-colors active:scale-[0.98] ${
                  packing ? "border border-line-strong bg-surface text-fg" : "bg-amber-400 text-slate-950 shadow-amber-400/40 hover:bg-amber-300"
                }`}
              >
                {packing ? "Cancel" : "＋ Pack"}
              </button>
            )
          }
        >
          {view.released.map((p) => card(p))}
        </Section>}

        <Section title="Packs" count={view.packs.length + view.atFactory.length} empty={byMaterial ? "Released parts are packed by material here by themselves." : "Use ＋ Pack to put Released parts in a pack."}>
          {view.packs.map(packCard)}
          {view.atFactory.map((p) => card(p))}
        </Section>

        <Section title="In Stock" count={view.inStockPacks.length + view.inStockParts.length} empty={`Nothing has come back in the last ${FACTORY_IN_STOCK_DAYS} days.`} collapsible small>
          {view.inStockPacks.map(packCard)}
          {view.inStockParts.map((p) => card(p))}
        </Section>

        {packing && (
          <div className="sticky bottom-3 z-30 rounded-xl border border-line-strong bg-surface/95 p-3 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold tabular-nums">{selected.size} selected</span>
              <span className="text-subtle">Tap Released cards to add them to the pack.</span>
              <span className="ml-auto" />
              <select className="input w-auto py-1" value={targetPack?.id ?? ""} onChange={(e) => setTarget(e.target.value)} aria-label="Pack to add to">
                <option value="">New pack</option>
                {view.packs.map((b) => (
                  <option key={b.id} value={b.id}>
                    {packLabel(b)}
                  </option>
                ))}
              </select>
              <button className="btn-primary active:scale-[0.98]" disabled={pending || selected.size === 0} onClick={submitPack}>
                {targetPack ? "✓ Add to pack" : "✓ Create pack"}
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

// A section of the page. Released and Packs always stay open; In Stock folds and starts closed.
function Section({
  title,
  count,
  empty,
  action,
  collapsible = false,
  small = false,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  action?: React.ReactNode;
  collapsible?: boolean;
  small?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!collapsible);
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const heading = (
    <>
      {collapsible && <Chevron open={open} small={small} />}
      <h2 className={small ? "text-base font-semibold text-fg-2" : "display text-2xl font-bold"}>{title}</h2>
      <span className={`rounded-full bg-raised font-bold text-fg-2 tabular-nums ${small ? "px-2 py-0.5 text-xs" : "px-2.5 py-0.5 text-sm"}`}>{count}</span>
      <div className={`flex-1 ${small ? "h-px bg-line" : "h-0.5 bg-line-strong"}`} />
    </>
  );
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-3">
        {collapsible ? (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="press flex flex-1 items-center gap-3 text-left">
            {heading}
          </button>
        ) : (
          <div className="flex flex-1 items-center gap-3">{heading}</div>
        )}
        {action}
      </div>
      {!open ? null : count === 0 ? (
        <p className="text-sm text-subtle">{empty}</p>
      ) : (
        <OpenBatchContext.Provider value={{ id: openBatch, set: setOpenBatch }}>
          <div className="card-grid fab-grid" style={{ "--card-min": small ? "180px" : "220px" } as React.CSSProperties}>
            {children}
          </div>
        </OpenBatchContext.Provider>
      )}
    </section>
  );
}
