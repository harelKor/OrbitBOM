"use client";

import { useSearchParams } from "next/navigation";
import {
  useMemo,
  useOptimistic,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import {
  adjustStock,
  bulkDeleteItems,
  bulkMoveItems,
  countStock,
} from "@/app/(app)/inventory/actions";
import { EditOnly, useEditMode } from "@/components/shell/ModeContext";
import { useEscape } from "@/components/ui/useEscape";
import {
  CategoryBoxes,
  pushQuery,
  type BoxCount,
} from "@/components/ui/CategoryBoxes";
import { Chevron } from "@/components/ui/Chevron";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import {
  groupOf,
  isCategoryGroup,
  type CategoryGroupId,
} from "@/config/inventory";
import { getCategory } from "@/lib/inventory/categories";
import {
  hasSeasonNeed,
  missing,
  standing,
  usedByRobots,
  type NeedView,
} from "@/lib/inventory/season";
import { matchesSearch } from "@/lib/inventory/searchWords";
import { keepPicks, matchesPicks, specGroups, type SpecGroup, type SpecPicks } from "@/lib/inventory/specFilters";
import { snapStock } from "@/lib/inventory/stock";
import { AddBox } from "./AddBox";
import { ImportDialog } from "./ImportDialog";
import { RecentActions } from "@/components/actions/RecentActions";
import type { RecentAction } from "@/lib/data/actions";
import { useInventoryPopup } from "./InventoryPopup";
import { ItemCard } from "./ItemCard";
import { ItemTable } from "./ItemTable";
import { ScanButton } from "./ScanButton";
import type { Item, Lookups } from "./types";

export type InventoryScope =
  | { kind: "home" }
  | { kind: "category" | "location" | "condition"; id: string };

type Open = { kind: "import" } | null;

// The Inventory pages' body. Home: the add / search box, the Short for Season / Short for Robots
// toggles, then the group boxes (a group opens its category boxes). A toggle (?view=) turns home
// into that view's cards in place, coloured red / orange / green and narrowed by the boxes. A
// category, location or condition page: the item cards, filtered by the same box (which also
// knows location names) and by condition and location. Edit mode adds the toolbar (import,
// Move, Delete); categories, locations and conditions are edited on the Settings page.
export function InventoryView({
  items,
  scope,
  actions,
  ...lookups
}: Lookups & {
  items: Item[];
  scope: InventoryScope;
  actions?: RecentAction[];
}) {
  const { openItem } = useInventoryPopup();
  const { conditions, locations, categories } = lookups;
  const [open, setOpen] = useState<Open>(null);
  const [q, setQ] = useState("");
  const [conditionId, setConditionId] = useState("");
  // A category's spec filter picks (Bore (ID) 8mm, Type Flanged...), forgotten on another category.
  const [specPick, setSpecPick] = useState<{ cat: string; picks: SpecPicks } | null>(null);
  // The location filter lives in the URL (?loc=), so the 📍 pills, the card tags and the
  // Any location menu share it on every Inventory page, and Back steps out of it.
  const params = useSearchParams();
  const locationId = params.get("loc") ?? "";
  const setLocationId = (id: string) => pushQuery({ loc: id || null });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Move / Delete: taps select cards, the bar at the bottom acts on them.
  const edit = useEditMode();
  const [picking, setPicking] = useState<"move" | "delete" | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveCat, setMoveCat] = useState("");
  const [moveLoc, setMoveLoc] = useState(""); // "" keep, "none" clear, else a location id
  const selecting = edit ? picking : null;

  const [optimistic, addOptimistic] = useOptimistic(
    items,
    (state, { id, delta }: { id: string; delta: number }) =>
      state.map((i) =>
        i.id === id
          ? { ...i, inStock: snapStock(i.inStock + delta, i.sheet) }
          : i,
      ),
  );
  const [busy, startTransition] = useTransition();
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
  const locationOf = (i: Item) =>
    i.locationId ??
    lookups.groups.find((g) => g.id === i.groupId)?.locationId ??
    null;
  const query = q.trim().toLowerCase();
  const matches = (i: Item) => {
    if (!query) return true;
    const text = [
      i.name,
      getCategory(categories, i.category)?.label,
      locationName.get(locationOf(i) ?? ""),
      ...i.cotsLinks.map((l) => l.site),
      ...Object.values(i.specs),
    ].join(" ");
    return matchesSearch(text, query);
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
  const home = scope.kind === "home";
  const rawView = params.get("view");
  const view: NeedView | null =
    home && (rawView === "season" || rawView === "robots") ? rawView : null;
  const rawGroup = params.get("group");
  const group: CategoryGroupId | null =
    home && rawGroup && isCategoryGroup(rawGroup) ? rawGroup : null;
  const cat = group ? params.get("cat") : null;
  const groupOfCat = new Map(categories.map((c) => [c.id, c.group]));
  const need: NeedView = view ?? "any";
  const inView = (i: Item) =>
    view === "season"
      ? hasSeasonNeed(i)
      : view === "robots"
        ? usedByRobots(i)
        : true;
  const inBox = (i: Item) =>
    (!group || groupOf(groupOfCat.get(i.category)) === group) &&
    (!cat || i.category === cat);
  const red = (i: Item) => standing(i, need) === "short";

  // In a category: a labeled row of pills per spec field (Bearings: Bore (ID), OD, Width, Type),
  // each showing only the values the other picks leave (Harel, 2026-10-28).
  const focusCat = getCategory(categories, scope.kind === "category" ? scope.id : cat);
  const picks = specPick && specPick.cat === focusCat?.id ? specPick.picks : {};
  const catItems = focusCat ? optimistic.filter((i) => i.category === focusCat.id) : [];
  const specRows = focusCat ? specGroups(focusCat, catItems, picks) : [];
  const togglePick = (fieldId: string, key: string) => {
    if (!focusCat) return;
    const next = { ...picks };
    if (next[fieldId] === key) delete next[fieldId];
    else next[fieldId] = key;
    setSpecPick({ cat: focusCat.id, picks: keepPicks(focusCat, next) });
  };
  // The rows fold behind a Filters toggle, closed at first, so the cards start near the top.
  const [filtersOpen, toggleFilters] = useFold("spec-filters", false);
  const inSub = (i: Item) => !focusCat || i.category !== focusCat.id || matchesPicks(i, picks);

  const RANK = { short: 0, ordered: 1, ok: 2 } as const;
  const shown = optimistic
    .filter(
      (i) =>
        inScope(i) &&
        inView(i) &&
        inBox(i) &&
        inSub(i) &&
        matches(i) &&
        (!conditionId || i.conditionId === conditionId) &&
        (!locationId || locationOf(i) === locationId),
    )
    .sort((a, b) =>
      view ? RANK[standing(a, view)] - RANK[standing(b, view)] : 0,
    );
  const boxes = home && !view && !query && !locationId;
  // In a view, the cards up top are only the ones still short or on order; every other item of
  // the view in the picked group / category box (all of them when none is picked) is in the
  // folded All items, so none shows twice (Harel, 2026-10-28).
  const shownMain = view
    ? shown.filter((i) => standing(i, view) !== "ok")
    : shown;
  const mainIds = new Set(shownMain.map((i) => i.id));
  const inViewAll = view
    ? optimistic.filter(
        (i) =>
          inView(i) &&
          inBox(i) &&
          !mainIds.has(i.id) &&
          (!conditionId || i.conditionId === conditionId) &&
          (!locationId || locationOf(i) === locationId),
      )
    : [];
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
    {
      id: "season" as const,
      title: "Short for Season",
      text: "Items under their Needed for Season count",
      items: optimistic.filter(
        (i) => hasSeasonNeed(i) && missing(i, "season") > 0,
      ),
    },
    {
      id: "robots" as const,
      title: "Short for Robots",
      text: "Items the active robots need more of than the shelf has",
      items: optimistic.filter((i) => (i.usage?.short ?? 0) > 0),
    },
  ];

  // Phones: the two selects share their own row, half each.
  const filters = (
    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
      <select
        value={conditionId}
        onChange={(e) => setConditionId(e.target.value)}
        className="input min-h-12 w-full min-w-0 self-start sm:w-auto"
      >
        <option value="">Any condition</option>
        {conditions.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <select
        value={locationId}
        onChange={(e) => setLocationId(e.target.value)}
        className="input min-h-12 w-full min-w-0 self-start sm:w-auto"
      >
        <option value="">Any location</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
  const pick = (m: "move" | "delete") => {
    setPicking((cur) => (cur === m ? null : m));
    setSelected(new Set());
    setMoveCat("");
    setMoveLoc("");
    setNotice(null);
  };
  useEscape(selecting !== null, () => {
    setPicking(null);
    setSelected(new Set());
  });
  const toggleSelected = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const done = (r: { error?: string; message?: string }) => {
    if (r.error) return setError(r.error);
    setNotice(r.message ?? null);
    setPicking(null);
    setSelected(new Set());
  };
  const confirmMove = () => {
    const ids = [...selected];
    const target = {
      ...(moveCat && { category: moveCat }),
      ...(moveLoc && { locationId: moveLoc === "none" ? null : moveLoc }),
    };
    startTransition(async () => {
      setError(null);
      done(await bulkMoveItems(ids, target));
    });
  };
  const confirmDelete = () => {
    const ids = [...selected];
    const used = optimistic.filter(
      (i) => selected.has(i.id) && i.usage?.parts.length,
    ).length;
    const warn = used
      ? ` ${used} of them ${used === 1 ? "is" : "are"} linked to BOM parts.`
      : "";
    if (
      !confirm(
        `Delete ${ids.length} item${ids.length === 1 ? "" : "s"} from the inventory?${warn}`,
      )
    )
      return;
    startTransition(async () => {
      setError(null);
      done(await bulkDeleteItems(ids));
    });
  };

  // Cards | Table, remembered in this browser.
  const layoutSaved = useSyncExternalStore(
    foldStore.subscribe,
    () => foldStore.read(LAYOUT_KEY),
    () => null,
  );
  const layout: Layout = layoutSaved === "table" ? "table" : "cards";
  const setLayout = (l: Layout) => {
    foldMemory.set(LAYOUT_KEY, l);
    try {
      localStorage.setItem(LAYOUT_KEY, l);
    } catch {}
    foldListeners.forEach((fn) => fn());
  };
  // Export spreadsheet: every item, in any mode (a backup any mentor can take).
  const exportButton = (
    <button
      type="button"
      className="btn min-h-11 active:scale-[0.98]"
      onClick={async () => {
        const { downloadInventory } = await import("@/lib/inventory/export");
        downloadInventory(optimistic, { categories, conditions, locations }, locationOf);
      }}
    >
      <Icon name="download" className="h-4 w-4" /> Export spreadsheet
    </button>
  );
  const layoutSwitch = (
    <Segmented
      label="Show items as"
      options={LAYOUTS}
      value={layout}
      onChange={setLayout}
    />
  );

  const grid = (list: Item[], cardView: NeedView = need) =>
    layout === "table" ? (
      <ItemTable
        items={list}
        categories={categories}
        conditions={conditions}
        locations={locations}
        locationOf={locationOf}
        view={cardView}
        hideCategory={scope.kind === "category" || !!cat}
        onStep={step}
        onCount={count}
        selected={selected}
        onToggleSelect={selecting ? toggleSelected : undefined}
      />
    ) : (
      <div
        className="card-grid"
        style={{ "--card-min": "220px" } as React.CSSProperties}
      >
        {list.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            categories={categories}
            condition={conditions.find((c) => c.id === item.conditionId)}
            location={locations.find((l) => l.id === locationOf(item))}
            view={cardView}
            onStep={(d) => step(item.id, d)}
            onCount={(n) => count(item.id, n)}
            hideCategory={scope.kind === "category" || !!cat}
            selected={selected.has(item.id)}
            onToggleSelect={
              selecting ? () => toggleSelected(item.id) : undefined
            }
          />
        ))}
      </div>
    );
  // Recent actions with each item's picture.
  const recent = (actions ?? []).map((a) => ({
    ...a,
    thumbs: a.thumbs.map((t) => {
      const i = items.find((x) => x.id === t.id);
      return {
        id: t.id,
        name: i?.name ?? "Removed item",
        url: i?.thumbUrl ?? null,
      };
    }),
  }));

  // Select all: the cards on screen (the main list, else every item on home).
  const selectable = boxes ? optimistic : shownMain;

  return (
    <div className={`space-y-4 ${selecting ? "pb-20" : ""}`}>
      <EditOnly>
        <div className="panel flex flex-wrap items-center gap-2 p-3">
          <button
            className="btn min-h-11"
            onClick={() => setOpen({ kind: "import" })}
          >
            Import spreadsheet
          </button>
          {exportButton}
          <span className="ml-auto" />
          {(["move", "delete"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => pick(m)}
              aria-pressed={picking === m}
              className={`btn min-h-11 active:scale-[0.98] ${picking === m ? (m === "delete" ? "border-rose-500 bg-rose-500 text-white" : "border-accent bg-accent text-white") : m === "delete" ? "text-rose-600" : ""}`}
            >
              {m === "move" ? "Move" : "Delete"}
            </button>
          ))}
        </div>
      </EditOnly>

      {/* The search row stays under the top bar while the list scrolls. */}
      {/* On phones the box and Scan get the whole first row and the filters the next. */}
      <div className="sticky top-[var(--topbar-h)] z-20 -mx-2 flex flex-wrap gap-2 bg-ink/95 px-2 py-2 backdrop-blur">
        <div className="flex w-full min-w-0 gap-2 sm:contents">
          <AddBox
            q={q}
            setQ={setQ}
            items={items}
            categories={categories}
            locations={locations}
            conditions={conditions}
            defaultCategory={scope.kind === "category" ? scope.id : null}
            defaultLocationId={
              scope.kind === "location" ? scope.id : locationId || null
            }
            placeholder={
              scope.kind === "home"
                ? "Do we have it? Name, size, bore, vendor, location…"
                : "Filter by name, size, vendor, location…"
            }
          />
          <ScanButton onCode={setQ} />
        </div>
        {!boxes && !showBoxes && filters}
      </div>

      {locations.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-subtle">📍</span>
          {locations.map((l) => {
            const on = locationId === l.id;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => setLocationId(on ? "" : l.id)}
                aria-pressed={on}
                className={`press min-h-9 rounded-full border px-3 py-1.5 text-xs font-semibold active:scale-[0.98] ${
                  on
                    ? "border-accent bg-accent text-white"
                    : "border-line-strong bg-surface text-fg-2 hover:border-accent hover:text-accent"
                }`}
              >
                {l.name}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
          Couldn&apos;t save: {error}
        </p>
      )}
      {notice && !error && (
        <p className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            className="press"
            aria-label="Dismiss"
            onClick={() => setNotice(null)}
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </p>
      )}

      {home && (
        <div className="grid grid-cols-2 gap-3">
          {toggles.map((t) => {
            const on = view === t.id;
            const urgent = t.items.some((i) => standing(i, t.id) === "short");
            // Shorter than the group boxes and tinted, so the two toggles read apart from them:
            // Season turns amber when on, Robots rose (Harel, 2026-10-28).
            const tint = on
              ? t.id === "season"
                ? "border-amber-400/70 bg-amber-500/15 ring-1 ring-amber-400/40 hover:border-amber-400"
                : "border-rose-400/70 bg-rose-500/15 ring-1 ring-rose-400/40 hover:border-rose-400"
              : "border-line-strong bg-raised/70 hover:border-sky-400/40";
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => pushQuery({ view: on ? null : t.id })}
                aria-pressed={on}
                className={`card-interactive group flex min-w-0 items-center gap-3 p-3 text-left active:scale-[0.98] sm:gap-4 sm:px-4 sm:py-3 ${tint}`}
              >
                <span
                  className={`display font-mono text-3xl tabular-nums sm:text-4xl ${urgent ? "text-rose-500" : "text-accent"}`}
                >
                  {t.items.length}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block display text-base leading-tight text-fg sm:text-xl">
                    {t.title}
                  </span>
                  <span className="hidden text-xs text-muted sm:block">
                    {on
                      ? "Showing every item in this view · tap to close"
                      : t.text}
                  </span>
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
          categoryHref={
            view
              ? undefined
              : (id) =>
                  `/inventory/c/${id}${locationId ? `?loc=${locationId}` : ""}`
          }
          route={false}
        />
      )}

      {boxes ? (
        <div className="space-y-4">
          {items.length === 0 && (
            <div className="panel p-6 text-sm text-muted">
              No inventory yet. In Edit mode, add items one by one or import a
              spreadsheet.
            </div>
          )}

          <Fold id="recent" title="Recent actions" defaultOpen>
            {recent.length ? (
              <RecentActions
                actions={recent}
                max={9}
                title={false}
                itemNoun={["item", "items"]}
                onOpen={(a) =>
                  openItem(
                    a.firstPartId,
                    items.find((i) => i.id === a.firstPartId),
                  )
                }
              />
            ) : (
              <p className="text-sm text-muted">
                No inventory changes this week.
              </p>
            )}
          </Fold>
          {items.length > 0 && (
            <Fold id="all" title={`All items (${items.length})`}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {filters}
                <span className="ml-auto" />
                {!edit && exportButton}
                {layoutSwitch}
              </div>
              {grid(
                optimistic.filter(
                  (i) =>
                    (!conditionId || i.conditionId === conditionId) &&
                    (!locationId || locationOf(i) === locationId),
                ),
              )}
            </Fold>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="font-mono tabular-nums">
              {shownMain.length} item{shownMain.length === 1 ? "" : "s"}
            </span>
            {specRows.length > 0 && <SpecFilterBar rows={specRows} picks={picks} open={filtersOpen} onToggle={toggleFilters} onPick={togglePick} onClear={() => setSpecPick(null)} />}
            {showBoxes && filters}
            <span className="ml-auto" />
            {!edit && exportButton}
            {layoutSwitch}
          </div>
          {filtersOpen && specRows.length > 0 && <SpecFilterRows rows={specRows} picks={picks} onPick={togglePick} />}
          {shownMain.length === 0 ? (
            <div className="panel p-6 text-sm text-muted">
              {query
                ? "Nothing matches that."
                : view && shown.length
                  ? "Nothing is short here: everything is covered."
                  : view === "season"
                    ? "No item has a Needed for Season count here. Set one in an item's window."
                    : view === "robots"
                      ? "No item here is used by an active robot."
                      : "No items here yet."}
            </div>
          ) : view ? (
            // The short and on-order items fold like All items below, closed at first (Harel, 2026-10-28).
            <Fold
              id={`short-in-${view}`}
              title={`${view === "season" ? "Short for Season" : "Short for Robots"} (${shownMain.length})`}
              defaultOpen={false}
            >
              {grid(shownMain)}
            </Fold>
          ) : (
            grid(shownMain)
          )}
          {view && inViewAll.length > 0 && (
            // The rest of this view in the picked box stays one tap away, folded (Harel, 2026-10-27).
            <div className="pt-2">
              <Fold
                id={`all-in-${view}`}
                title={`All items (${inViewAll.length})`}
                defaultOpen={false}
              >
                {grid(inViewAll)}
              </Fold>
            </div>
          )}
        </div>
      )}

      {selecting && (
        <div className="sticky bottom-3 z-30 rounded-xl border border-line-strong bg-surface/95 p-3 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono font-semibold tabular-nums">
              {selected.size} selected
            </span>
            {selecting === "move" ? (
              <>
                <select
                  value={moveCat}
                  onChange={(e) => setMoveCat(e.target.value)}
                  className="input min-h-11 w-auto py-1.5 text-sm"
                  aria-label="Move to category"
                >
                  <option value="">Category: keep</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select
                  value={moveLoc}
                  onChange={(e) => setMoveLoc(e.target.value)}
                  className="input min-h-11 w-auto py-1.5 text-sm"
                  aria-label="Move to location"
                >
                  <option value="">Location: keep</option>
                  <option value="none">No location</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <span className="ml-auto" />
                <button
                  className="btn-primary min-h-11 active:scale-[0.98]"
                  disabled={
                    busy || selected.size === 0 || (!moveCat && !moveLoc)
                  }
                  onClick={confirmMove}
                >
                  ✓ Confirm move
                </button>
              </>
            ) : (
              <>
                <span className="text-subtle">Tap the items to delete.</span>
                <span className="ml-auto" />
                <button
                  className="btn min-h-11 border-rose-500 bg-rose-500 text-white hover:bg-rose-400 active:scale-[0.98] disabled:opacity-50"
                  disabled={busy || selected.size === 0}
                  onClick={confirmDelete}
                >
                  Delete{" "}
                  <span className="font-mono tabular-nums">
                    {selected.size}
                  </span>{" "}
                  item{selected.size === 1 ? "" : "s"}
                </button>
              </>
            )}
            <button
              className="btn min-h-11"
              onClick={() => setSelected(new Set(selectable.map((i) => i.id)))}
            >
              Select all
            </button>
            <button className="btn min-h-11" onClick={() => pick(selecting)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <ImportDialog
        open={open?.kind === "import"}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

type Layout = "cards" | "table";
const LAYOUT_KEY = "orbit-inventory-layout";
const LAYOUTS: { value: Layout; label: string }[] = [
  { value: "cards", label: "Cards" },
  { value: "table", label: "Table" },
];

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

// Open or closed, remembered by this browser under `orbit-inventory-fold-<id>`.
function useFold(id: string, defaultOpen: boolean): [boolean, () => void] {
  const key = `orbit-inventory-fold-${id}`;
  const saved = useSyncExternalStore(
    foldStore.subscribe,
    () => foldStore.read(key),
    () => null,
  );
  const open = saved === null ? defaultOpen : saved === "1";
  const toggle = () => {
    foldMemory.set(key, open ? "0" : "1");
    try {
      localStorage.setItem(key, open ? "0" : "1");
    } catch {}
    foldListeners.forEach((fn) => fn());
  };
  return [open, toggle];
}

function Fold({
  id,
  title,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, toggle] = useFold(id, defaultOpen);
  return (
    <section className="panel">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="press flex min-h-14 w-full items-center gap-2 px-4 text-left"
      >
        <Icon
          name="chevron"
          className={`h-4 w-4 text-subtle transition-transform ${open ? "rotate-90" : ""}`}
        />
        <span className="text-lg font-semibold">{title}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </section>
  );
}

// The Filters toggle on the item count row. Closed, the picks in use sit next to it (✕ removes
// one) with Clear, so the list never filters without showing why (Harel, 2026-10-28).
function SpecFilterBar({
  rows,
  picks,
  open,
  onToggle,
  onPick,
  onClear,
}: {
  rows: SpecGroup[];
  picks: SpecPicks;
  open: boolean;
  onToggle: () => void;
  onPick: (fieldId: string, key: string) => void;
  onClear: () => void;
}) {
  const active = rows.flatMap((g) => {
    const v = g.values.find((x) => x.key === picks[g.field.id]);
    return v ? [{ g, v }] : [];
  });
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`press inline-flex min-h-9 items-center gap-1 rounded-full border pr-3 pl-1.5 text-xs font-semibold transition-colors duration-150 hover:border-sky-400/40 ${active.length ? "border-accent text-accent" : "border-line-strong text-fg-2"}`}
      >
        <Chevron open={open} small className="hover:bg-transparent" />
        Filters
        {active.length > 0 && <span className="ml-0.5 rounded-full bg-accent px-1.5 font-mono text-[10px] text-white tabular-nums">{active.length}</span>}
      </button>
      {!open &&
        active.map(({ g, v }) => (
          <button
            key={g.field.id}
            type="button"
            onClick={() => onPick(g.field.id, v.key)}
            title={`Remove ${g.label}: ${v.label}`}
            className="press inline-flex min-h-9 items-center gap-1.5 rounded-full border border-accent bg-accent px-3 text-xs font-semibold text-white"
          >
            <span className="text-[10px] tracking-wider uppercase opacity-75">{g.label}</span>
            {v.label}
            <Icon name="close" className="h-3 w-3" />
          </button>
        ))}
      {active.length > 0 && (
        <button type="button" onClick={onClear} className="press min-h-9 px-1 text-xs font-semibold text-accent hover:underline">
          Clear
        </button>
      )}
    </>
  );
}

// The open filters: a labeled row per field. A row with more than ROW_MAX values shows the
// first ones (and its pick) with "+N more"; its label folds it back.
const ROW_MAX = 10;
function SpecFilterRows({ rows, picks, onPick }: { rows: SpecGroup[]; picks: SpecPicks; onPick: (fieldId: string, key: string) => void }) {
  const [wide, setWide] = useState<Set<string>>(new Set());
  const flip = (id: string) =>
    setWide((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="space-y-1.5">
      {rows.map((g) => {
        const long = g.values.length > ROW_MAX;
        const all = !long || wide.has(g.field.id);
        const shown = all ? g.values : g.values.filter((v, i) => i < ROW_MAX || v.key === picks[g.field.id]);
        return (
          <div key={g.field.id} className="flex flex-wrap items-center gap-1.5">
            {long ? (
              <button
                type="button"
                onClick={() => flip(g.field.id)}
                aria-expanded={all}
                className="press flex w-full shrink-0 items-center gap-0.5 text-left text-[10px] font-semibold tracking-wider text-subtle uppercase hover:text-fg sm:w-20"
              >
                {g.label}
                <Icon name="chevron" className={`h-3 w-3 transition-transform duration-150 ${all ? "rotate-90" : ""}`} />
              </button>
            ) : (
              <span className="w-full shrink-0 text-[10px] font-semibold tracking-wider text-subtle uppercase sm:w-20">{g.label}</span>
            )}
            {shown.map((v) => (
              <SubPill key={v.key} on={picks[g.field.id] === v.key} onClick={() => onPick(g.field.id, v.key)}>
                {v.label}
                <span className="ml-1.5 font-mono text-[10px] tabular-nums opacity-60">{v.count}</span>
              </SubPill>
            ))}
            {long && (
              <button type="button" onClick={() => flip(g.field.id)} className="press min-h-9 px-2 font-mono text-xs font-semibold text-accent tabular-nums hover:underline">
                {all ? "Show less" : `+${g.values.length - shown.length} more`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SubPill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`press inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold transition-colors duration-150 ${on ? "border-accent bg-accent text-white" : "border-line-strong text-fg-2 hover:border-sky-400/40 hover:text-fg"}`}
    >
      {children}
    </button>
  );
}
