"use client";

import Link from "next/link";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { INVENTORY_CATEGORIES, getInventoryCategory } from "@/config/inventory";
import { getPartType } from "@/config/partTypes";
import { adjustStock } from "@/app/(app)/inventory/actions";
import { EditOnly } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { snapStock } from "@/lib/inventory/stock";
import { ImportDialog } from "./ImportDialog";
import { ItemCard } from "./ItemCard";
import { ItemDialog } from "./ItemDialog";
import { ConditionsDialog, LocationsDialog, PartTypesDialog } from "./ListDialogs";
import type { Item, Lookups } from "./types";

export type InventoryScope = { kind: "home" } | { kind: "short" } | { kind: "category"; id: string };

type Open = { kind: "item" } | { kind: "types" | "conditions" | "locations" | "import" } | null;

// The Inventory pages' body. Home: a search over everything, then a box per category and a
// Short for robots card. A category or Short: the item cards, filtered by the same search and by
// condition and location. Edit mode adds the toolbar.
export function InventoryView({ items, scope, ...lookups }: Lookups & { items: Item[]; scope: InventoryScope }) {
  const { conditions, locations } = lookups;
  const [open, setOpen] = useState<Open>(null);
  const [q, setQ] = useState("");
  const [conditionId, setConditionId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [optimistic, addOptimistic] = useOptimistic(items, (state, { id, delta }: { id: string; delta: number }) =>
    state.map((i) => (i.id === id ? { ...i, inStock: snapStock(i.inStock + delta, i.sheet) } : i)),
  );
  const [, startTransition] = useTransition();
  const step = (id: string, delta: number) =>
    startTransition(async () => {
      setError(null);
      addOptimistic({ id, delta });
      const result = await adjustStock(id, delta);
      if (result.error) setError(result.error);
    });

  const locationOf = (i: Item) => i.locationId ?? lookups.groups.find((g) => g.id === i.groupId)?.locationId ?? null;
  const query = q.trim().toLowerCase();
  const matches = (i: Item) => {
    if (!query) return true;
    const type = i.templateId ? getPartType(i.templateId) : undefined;
    const text = [i.name, i.material, i.vendorName, type?.name, getInventoryCategory(i.category)?.label, ...Object.values(i.templateValues)].join(" ").toLowerCase();
    return query.split(/\s+/).every((word) => text.includes(word));
  };
  const inScope = (i: Item) => (scope.kind === "category" ? i.category === scope.id : scope.kind === "short" ? (i.usage?.short ?? 0) > 0 : true);
  const shown = optimistic.filter(
    (i) => inScope(i) && matches(i) && (!conditionId || i.conditionId === conditionId) && (!locationId || locationOf(i) === locationId),
  );
  const boxes = scope.kind === "home" && !query;

  const perCategory = useMemo(() => {
    const m = new Map<string, { items: number; short: number }>();
    for (const i of items) {
      const c = m.get(i.category) ?? { items: 0, short: 0 };
      c.items++;
      if ((i.usage?.short ?? 0) > 0) c.short++;
      m.set(i.category, c);
    }
    return m;
  }, [items]);
  const shortCount = items.filter((i) => (i.usage?.short ?? 0) > 0).length;

  return (
    <div className="space-y-4">
      <EditOnly>
        <div className="panel flex flex-wrap items-center gap-2 p-3">
          <button className="btn" onClick={() => setOpen({ kind: "types" })}>
            Part types
          </button>
          <button className="btn" onClick={() => setOpen({ kind: "conditions" })}>
            Conditions
          </button>
          <button className="btn" onClick={() => setOpen({ kind: "locations" })}>
            Locations
          </button>
          <button className="btn" onClick={() => setOpen({ kind: "import" })}>
            Import spreadsheet
          </button>
          <button className="btn-primary ml-auto" onClick={() => setOpen({ kind: "item" })}>
            + Add inventory item
          </button>
        </div>
      </EditOnly>

      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-md">
          <Icon name="search" className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={scope.kind === "home" ? "Do we have it? Name, size, bore, vendor…" : "Filter by name, size, vendor…"}
            className="input py-2.5 pl-9 text-base"
            aria-label="Search the inventory"
          />
        </label>
        {!boxes && (
          <>
            <select value={conditionId} onChange={(e) => setConditionId(e.target.value)} className="input w-auto">
              <option value="">Any condition</option>
              {conditions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input w-auto">
              <option value="">Any location</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}

      {boxes ? (
        <div className="space-y-4">
          <Link href="/inventory/short" className="card-interactive group flex items-center gap-6 p-6">
            <span className={`display font-mono text-6xl tabular-nums ${shortCount ? "text-amber-600" : "text-accent"}`}>{shortCount}</span>
            <span className="min-w-0 flex-1">
              <span className="block display text-3xl text-fg">Short for robots</span>
              <span className="text-sm text-muted">Items the active robots need more of than the shelf has</span>
            </span>
            <Icon name="arrow" className="h-6 w-6 text-subtle transition-transform group-hover:translate-x-1 group-hover:text-accent" />
          </Link>
          <div className="card-grid" style={{ "--card-min": "190px" } as React.CSSProperties}>
            {INVENTORY_CATEGORIES.map((c) => {
              const n = perCategory.get(c.id);
              return (
                <Link key={c.id} href={`/inventory/c/${c.id}`} className="card-interactive group flex min-h-32 flex-col justify-between p-4">
                  <span className="flex items-start justify-between">
                    <span className="display font-mono text-4xl text-accent tabular-nums">{n?.items ?? 0}</span>
                    {!!n?.short && (
                      <span className="rounded-full bg-amber-500 px-2 py-0.5 font-mono text-[11px] font-bold text-white tabular-nums" title="Items short for robots">
                        {n.short} short
                      </span>
                    )}
                  </span>
                  <span className="text-base font-semibold text-fg group-hover:text-accent">{c.label}</span>
                </Link>
              );
            })}
          </div>
          {items.length === 0 && <div className="panel p-6 text-sm text-muted">No inventory yet. In Edit mode, add items one by one or import a spreadsheet.</div>}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-sm text-muted">
            {shown.length} item{shown.length === 1 ? "" : "s"}
          </div>
          {shown.length === 0 ? (
            <div className="panel p-6 text-sm text-muted">{query ? "Nothing matches that." : scope.kind === "short" ? "Nothing is short: the shelf covers every linked part." : "No items here yet."}</div>
          ) : (
            <div className="card-grid" style={{ "--card-min": "220px" } as React.CSSProperties}>
              {shown.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  condition={conditions.find((c) => c.id === item.conditionId)}
                  location={locations.find((l) => l.id === locationOf(item))?.name}
                  onStep={(d) => step(item.id, d)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <ItemDialog
        key={open?.kind === "item" ? "new" : "closed"}
        open={open?.kind === "item"}
        item={null}
        defaultCategory={scope.kind === "category" ? scope.id : null}
        lookups={lookups}
        onClose={() => setOpen(null)}
      />
      <PartTypesDialog open={open?.kind === "types"} onClose={() => setOpen(null)} />
      <ConditionsDialog open={open?.kind === "conditions"} conditions={conditions} onClose={() => setOpen(null)} />
      <LocationsDialog open={open?.kind === "locations"} locations={locations} onClose={() => setOpen(null)} />
      <ImportDialog open={open?.kind === "import"} onClose={() => setOpen(null)} />
    </div>
  );
}
