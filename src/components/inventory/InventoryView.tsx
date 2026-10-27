"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useOptimistic, useState, useSyncExternalStore, useTransition } from "react";
import { adjustStock, countStock } from "@/app/(app)/inventory/actions";
import { EditOnly } from "@/components/shell/ModeContext";
import { CategoryBoxes, pushQuery, type BoxCount } from "@/components/ui/CategoryBoxes";
import { Icon } from "@/components/ui/Icon";
import { groupOf, isCategoryGroup, type CategoryGroupId } from "@/config/inventory";
import { getCategory } from "@/lib/inventory/categories";
import { hasSeasonNeed, missing, standing, usedByRobots, type NeedView } from "@/lib/inventory/season";
import { snapStock } from "@/lib/inventory/stock";
import { AddBox } from "./AddBox";
import { CategorySettings } from "./CategorySettings";
import { ImportDialog } from "./ImportDialog";
import { RecentActions } from "@/components/actions/RecentActions";
import type { RecentAction } from "@/lib/data/actions";
import { useInventoryPopup } from "./InventoryPopup";
import { ItemCard } from "./ItemCard";
import { ScanButton } from "./ScanButton";
import { ConditionsDialog, LocationsDialog } from "./ListDialogs";
import type { Item, Lookups } from "./types";

export type InventoryScope = { kind: "home" } | { kind: "category" | "location" | "condition"; id: string };

type Open = { kind: "settings" | "conditions" | "locations" | "import" } | null;

// The Inventory pages' body. Home: the add / search box, the Short for Season / Short for Robots
// toggles, then the group boxes (a group opens its category boxes). A toggle (?view=) turns home
// into that view's cards in place, coloured red / orange / green and narrowed by the boxes. A
// category, location or condition page: the item cards, filtered by the same box (which also
// knows location names) and by condition and location. Edit mode adds the toolbar, the add flow
// and the category settings panel.
export function InventoryView({ items, scope, actions, ...lookups }: Lookups & { items: Item[]; scope: InventoryScope; actions?: RecentAction[] }) {
  const { openItem } = useInventoryPopup();
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
          : true;

  // Home's place, kept in the URL: the Short toggle, and the group and category boxes.
  const params = useSearchParams();
  const home = scope.kind === "home";
  const rawView = params.get("view");
  const view: NeedView | null = home && (rawView === "season" || rawView === "robots") ? rawView : null;
  const rawGroup = params.get("group");
  const group: CategoryGroupId | null = home && rawGroup && isCategoryGroup(rawGroup) ? rawGroup : null;
  const cat = group ? params.get("cat") : null;
  const groupOfCat = new Map(categories.map((c) => [c.id, c.group]));
  const need: NeedView = view ?? "any";
  const inView = (i: Item) => (view === "season" ? hasSeasonNeed(i) : view === "robots" ? usedByRobots(i) : true);
  const inBox = (i: Item) => (!group || groupOf(groupOfCat.get(i.category)) === group) && (!cat || i.category === cat);
  const red = (i: Item) => standing(i, need) === "short";

  const RANK = { short: 0, ordered: 1, ok: 2 } as const;
  const shown = optimistic
    .filter((i) => inScope(i) && inView(i) && inBox(i) && matches(i) && (!conditionId || i.conditionId === conditionId) && (!locationId || locationOf(i) === locationId))
    .sort((a, b) => (view ? RANK[standing(a, view)] - RANK[standing(b, view)] : 0));
  const boxes = home && !view && !query;
  const showBoxes = home && (!query || !!view);

  // Each group's and category's items (in the view, when one is on) and how many are short.
  const counts = useMemo(() => {
    const m = new Map<string, BoxCount>();
    const add = (key: string, short: boolean) => {
      const c = m.get(key) ?? { count: 0, short: 0 };
      c.count++;
      if (short) c.short!++;
      m.set(key, c);
    };
    for (const i of optimistic) {
      if (!inView(i)) continue;
      const short = red(i);
      add(i.category, short);
      add(groupOf(groupOfCat.get(i.category)), short);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inView and red follow view
  }, [optimistic, view, categories]);
  const toggles = [
    { id: "season" as const, title: "Short for Season", text: "Items under their Needed for Season count", items: optimistic.filter((i) => hasSeasonNeed(i) && missing(i, "season") > 0) },
    { id: "robots" as const, title: "Short for Robots", text: "Items the active robots need more of than the shelf has", items: optimistic.filter((i) => (i.usage?.short ?? 0) > 0) },
  ];

  const filters = (
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
  );
  const grid = (list: Item[]) => (
    <div className="card-grid" style={{ "--card-min": "220px" } as React.CSSProperties}>
      {list.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          categories={categories}
          condition={conditions.find((c) => c.id === item.conditionId)}
          location={locations.find((l) => l.id === locationOf(item))}
          view={need}
          onStep={(d) => step(item.id, d)}
          onCount={(n) => count(item.id, n)}
        />
      ))}
    </div>
  );
  // Recent actions with each item's picture.
  const recent = (actions ?? []).map((a) => ({
    ...a,
    thumbs: a.thumbs.map((t) => {
      const i = items.find((x) => x.id === t.id);
      return { id: t.id, name: i?.name ?? "Removed item", url: i?.thumbUrl ?? null };
    }),
  }));

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
        <ScanButton onCode={setQ} />
        {!boxes && !showBoxes && filters}
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

      {home && (
        <div className="grid grid-cols-2 gap-3">
          {toggles.map((t) => {
            const on = view === t.id;
            const urgent = t.items.some((i) => standing(i, t.id) === "short");
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => pushQuery({ view: on ? null : t.id })}
                aria-pressed={on}
                className={`card-interactive group flex min-w-0 items-center gap-3 p-4 text-left active:scale-[0.98] sm:gap-5 sm:p-5 ${on ? "border-sky-400/60 bg-sky-500/10 ring-1 ring-sky-400/40" : ""}`}
              >
                <span className={`display font-mono text-4xl tabular-nums sm:text-5xl ${urgent ? "text-rose-500" : "text-accent"}`}>{t.items.length}</span>
                <span className="min-w-0 flex-1">
                  <span className="block display text-lg leading-tight text-fg sm:text-2xl">{t.title}</span>
                  <span className="hidden text-sm text-muted sm:block">{on ? "Showing every item in this view · tap to close" : t.text}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {showBoxes && (
        <CategoryBoxes
          categories={categories}
          counts={counts}
          group={group}
          category={cat}
          onGroup={(g) => pushQuery({ group: g, cat: null })}
          onCategory={(c) => pushQuery({ cat: c })}
          categoryHref={view ? undefined : (id) => `/inventory/c/${id}`}
        />
      )}

      {boxes ? (
        <div className="space-y-4">
          {items.length === 0 && <div className="panel p-6 text-sm text-muted">No inventory yet. In Edit mode, add items one by one or import a spreadsheet.</div>}

          <Fold id="recent" title="Recent actions" defaultOpen>
            {recent.length ? (
              <RecentActions actions={recent} max={9} title={false} itemNoun={["item", "items"]} onOpen={(a) => openItem(a.firstPartId, items.find((i) => i.id === a.firstPartId))} />
            ) : (
              <p className="text-sm text-muted">No inventory changes this week.</p>
            )}
          </Fold>
          {items.length > 0 && (
            <Fold id="all" title={`All items (${items.length})`}>
              <div className="mb-3 flex flex-wrap gap-2">{filters}</div>
              {grid(optimistic.filter((i) => (!conditionId || i.conditionId === conditionId) && (!locationId || locationOf(i) === locationId)))}
            </Fold>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="font-mono tabular-nums">
              {shown.length} item{shown.length === 1 ? "" : "s"}
            </span>
            {showBoxes && filters}
          </div>
          {shown.length === 0 ? (
            <div className="panel p-6 text-sm text-muted">{query ? "Nothing matches that." : view === "season" ? "No item has a Needed for Season count here. Set one in an item's window." : view === "robots" ? "No item here is used by an active robot." : "No items here yet."}</div>
          ) : (
            grid(shown)
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

// A home section that opens and closes; each browser remembers which are open.
const foldListeners = new Set<() => void>();
const foldMemory = new Map<string, string>(); // still works when the browser won't store
const foldStore = {
  subscribe: (fn: () => void) => {
    foldListeners.add(fn);
    return () => foldListeners.delete(fn);
  },
  read: (key: string) => {
    if (foldMemory.has(key)) return foldMemory.get(key)!;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
};

function Fold({ id, title, defaultOpen = false, children }: { id: string; title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const key = `orbit-inventory-fold-${id}`;
  const saved = useSyncExternalStore(foldStore.subscribe, () => foldStore.read(key), () => null);
  const open = saved === null ? defaultOpen : saved === "1";
  const toggle = () => {
    foldMemory.set(key, open ? "0" : "1");
    try {
      localStorage.setItem(key, open ? "0" : "1");
    } catch {}
    foldListeners.forEach((fn) => fn());
  };
  return (
    <section className="panel">
      <button type="button" onClick={toggle} aria-expanded={open} className="press flex min-h-14 w-full items-center gap-2 px-4 text-left">
        <Icon name="chevron" className={`h-4 w-4 text-subtle transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="text-lg font-semibold">{title}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}
