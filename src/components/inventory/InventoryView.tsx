"use client";

import Link from "next/link";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { adjustStock, countStock } from "@/app/(app)/inventory/actions";
import { EditOnly } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { getCategory } from "@/lib/inventory/categories";
import { snapStock } from "@/lib/inventory/stock";
import { AddBox } from "./AddBox";
import { CategorySettings } from "./CategorySettings";
import { ImportDialog } from "./ImportDialog";
import { ItemCard } from "./ItemCard";
import { ConditionsDialog, LocationsDialog } from "./ListDialogs";
import type { Item, Lookups } from "./types";

export type InventoryScope = { kind: "home" } | { kind: "short" } | { kind: "category" | "location" | "condition"; id: string };

type Open = { kind: "settings" | "conditions" | "locations" | "import" } | null;

// The Inventory pages' body. Home: the add / search box, then a box per category and a Short for
// robots card. A category, location, condition or Short: the item cards, filtered by the same box
// (which also knows location names) and by condition and location. Edit mode adds the toolbar,
// the add flow and the category settings panel.
export function InventoryView({ items, scope, ...lookups }: Lookups & { items: Item[]; scope: InventoryScope }) {
  const { conditions, locations, categories } = lookups;
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

  const count = (id: string, amount: number) =>
    startTransition(async () => {
      setError(null);
      const item = optimistic.find((i) => i.id === id);
      if (item) addOptimistic({ id, delta: amount - item.inStock });
      const result = await countStock(id, amount);
      if (result.error) setError(result.error);
    });

  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const locationOf = (i: Item) => i.locationId ?? lookups.groups.find((g) => g.id === i.groupId)?.locationId ?? null;
  const query = q.trim().toLowerCase();
  const matches = (i: Item) => {
    if (!query) return true;
    const text = [i.name, getCategory(categories, i.category)?.label, locationName.get(locationOf(i) ?? ""), ...i.cotsLinks.map((l) => l.site), ...Object.values(i.specs)].join(" ").toLowerCase();
    return query.split(/\s+/).every((word) => text.includes(word));
  };
  const inScope = (i: Item) =>
    scope.kind === "category"
      ? i.category === scope.id
      : scope.kind === "location"
        ? locationOf(i) === scope.id
        : scope.kind === "condition"
          ? i.conditionId === scope.id
          : scope.kind === "short"
            ? (i.usage?.short ?? 0) > 0
            : true;
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
          <button className="btn min-h-11" onClick={() => setOpen({ kind: "settings" })}>
            <Icon name="gear" className="h-4 w-4" /> Categories
          </button>
          <button className="btn min-h-11" onClick={() => setOpen({ kind: "conditions" })}>
            Conditions
          </button>
          <button className="btn min-h-11" onClick={() => setOpen({ kind: "locations" })}>
            Locations
          </button>
          <button className="btn min-h-11" onClick={() => setOpen({ kind: "import" })}>
            Import spreadsheet
          </button>
        </div>
      </EditOnly>

      <div className="flex flex-wrap gap-2">
        <AddBox
          q={q}
          setQ={setQ}
          items={items}
          categories={categories}
          locations={locations}
          conditions={conditions}
          defaultCategory={scope.kind === "category" ? scope.id : null}
          defaultLocationId={scope.kind === "location" ? scope.id : null}
          placeholder={scope.kind === "home" ? "Do we have it? Name, size, bore, vendor, location…" : "Filter by name, size, vendor, location…"}
        />
        {!boxes && (
          <>
            <select value={conditionId} onChange={(e) => setConditionId(e.target.value)} className="input min-h-12 w-auto self-start">
              <option value="">Any condition</option>
              {conditions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="input min-h-12 w-auto self-start">
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

      {locations.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-subtle">📍</span>
          {locations.map((l) => (
            <Link
              key={l.id}
              href={scope.kind === "location" && scope.id === l.id ? "/inventory" : `/inventory/location/${l.id}`}
              className={`press min-h-9 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                scope.kind === "location" && scope.id === l.id ? "border-accent bg-accent text-white" : "border-line-strong bg-surface text-fg-2 hover:border-accent hover:text-accent"
              }`}
            >
              {l.name}
            </Link>
          ))}
        </div>
      )}

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
            {categories.map((c) => {
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
                  categories={categories}
                  condition={conditions.find((c) => c.id === item.conditionId)}
                  location={locations.find((l) => l.id === locationOf(item))}
                  onStep={(d) => step(item.id, d)}
                  onCount={(n) => count(item.id, n)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <CategorySettings open={open?.kind === "settings"} onClose={() => setOpen(null)} categories={categories} locations={locations} items={items} />
      <ConditionsDialog open={open?.kind === "conditions"} conditions={conditions} onClose={() => setOpen(null)} />
      <LocationsDialog open={open?.kind === "locations"} locations={locations} onClose={() => setOpen(null)} />
      <ImportDialog open={open?.kind === "import"} onClose={() => setOpen(null)} />
    </div>
  );
}
