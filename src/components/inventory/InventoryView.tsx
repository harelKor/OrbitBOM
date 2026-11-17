"use client";

import { useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
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
import { Dialog } from "@/components/Dialog";
import { EditOnly, useManage, usePermissions } from "@/components/shell/ModeContext";
import { IconButton } from "@/components/ui/IconButton";
import { useEscape } from "@/components/ui/useEscape";
import { holdTarget, useLongPress } from "@/components/ui/longPress";
import {
  CategoryBoxes,
  pushQuery,
  type BoxCount,
} from "@/components/ui/CategoryBoxes";
import { Chevron } from "@/components/ui/Chevron";
import { Icon } from "@/components/ui/Icon";
import { ViewPicker } from "@/components/ui/ViewPicker";
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
import { countPieces, stepStock } from "@/lib/inventory/stock";
import { safeAction } from "@/lib/safeAction";
import { AddBox, haloItem, type AddBoxHandle } from "./AddBox";
import { ImportDialog } from "./ImportDialog";
import { RecentActions } from "@/components/actions/RecentActions";
import type { RecentAction } from "@/lib/data/actions";
import { useInventoryPopup } from "./InventoryPopup";
import { ItemListRow } from "./ItemListRow";
import { ItemCard } from "./ItemCard";
import { ItemTable } from "./ItemTable";
import { useDesktop, usePhone } from "@/components/ui/usePhone";
import { ScanButton } from "./ScanButton";
import { LocationPicker } from "./LocationPicker";
import { ShopMap } from "@/components/map/ShopMap";
import { placeStats } from "@/components/map/stats";
import { inPlace, placeIndex, placeWord, zoneColor, zoneOf } from "@/lib/inventory/places";
import type { Condition, Item, Lookups } from "./types";
import { Notice } from "@/components/ui/Notice";
import { askConfirm } from "@/components/ui/useConfirm";

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
  // Items added on this visit, newest first, stay on top of the list until the page is left. A
  // just-added item glows warm yellow until the next click or tap anywhere, then the light fades
  // (Harel, 2026-10-29).
  const [added, setAdded] = useState<string[]>([]);
  const [lit, setLit] = useState<string[]>([]);
  const [fading, setFading] = useState<string[]>([]);
  const onAdded = (id: string) => {
    setAdded((a) => [id, ...a.filter((x) => x !== id)]);
    setLit((l) => [id, ...l.filter((x) => x !== id)]);
  };
  useEffect(() => {
    if (!lit.length) return;
    const off = () => {
      setFading(lit);
      setLit([]);
      setTimeout(() => setFading((f) => (f === lit ? [] : f)), 800);
    };
    // Listening starts after the click that added the item.
    const t = setTimeout(() => window.addEventListener("pointerdown", off, { once: true }), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", off);
    };
  }, [lit]);
  const saving = (id: string) => id.startsWith("new:");
  const glowOf = (id: string) => (lit.includes(id) || saving(id) ? "lit" : fading.includes(id) ? "fade" : undefined);
  // Scan is for phones, and shows only while the add box is focused (Harel, 2026-10-29).
  const phone = usePhone();
  const [boxFocus, setBoxFocus] = useState(false);
  const addBox = useRef<AddBoxHandle>(null);
  const [conditionId, setConditionId] = useState("");
  // All items' season filter (Harel, 2026-11-13): one season's items, without their now-identical tag.
  const [season, setSeason] = useState<"" | Item["seasonTag"]>("");
  // A category's spec filter picks (ID 8, Type Flanged...), forgotten on another category.
  const [specPick, setSpecPick] = useState<{ cat: string; picks: SpecPicks } | null>(null);
  // The location filter lives in the URL (?loc=), so the workshop map and the card tags share
  // it on every Inventory page, and Back steps out of it.
  const params = useSearchParams();
  const locationId = params.get("loc") ?? "";
  const setLocationId = (id: string) => pushQuery({ loc: id || null });
  // The Added popup's arrow from another page lands here with ?added=<id>: the item is lit,
  // scrolled to the middle of the screen, and the param leaves the URL (Harel, 2026-11-03).
  // An item window's arrow does the same with ?goto=<id>, without listing it as added.
  const goto = params.get("goto");
  const addedParam = params.get("added") ?? goto;
  useEffect(() => {
    if (!addedParam) return;
    if (goto) setLit((l) => [addedParam, ...l.filter((x) => x !== addedParam)]);
    else onAdded(addedParam);
    const url = new URL(window.location.href);
    url.searchParams.delete("added");
    url.searchParams.delete("goto");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    let tries = 0;
    let frame = 0;
    const find = () => {
      const el = document.querySelector(`[data-item="${CSS.escape(addedParam)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return haloItem(el);
      }
      if (++tries < 300) frame = requestAnimationFrame(find);
    };
    frame = requestAnimationFrame(find);
    return () => cancelAnimationFrame(frame);
  }, [addedParam, goto]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Move / Delete: taps select cards, the bar at the bottom acts on them. On a phone a long press
  // on an item selects it and opens the same bar with Edit, Move and Delete (Harel, 2026-11-12).
  const edit = useManage();
  // The Build Team has no Export spreadsheet button (Harel, 2026-11-02).
  const hideExport = usePermissions().mode === "build";
  const [picking, setPicking] = useState<"select" | "move" | "delete" | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moveCat, setMoveCat] = useState("");
  const [moveLoc, setMoveLoc] = useState(""); // "" keep, "none" clear, else a location id
  const selecting = edit ? picking : null;

  // Stock steps, and an item being added (on top, glowing, until its save comes back).
  const [optimistic, addOptimistic] = useOptimistic(
    items,
    (state, change: { id: string; delta: number; size?: string } | { id: string; count: number } | { add: Item }) =>
      "add" in change
        ? [change.add, ...state]
        : state.map((i) =>
            i.id === change.id
              ? { ...i, ...("count" in change ? countPieces(i, change.count) : stepStock(i, change.delta, change.size)) }
              : i,
          ),
  );
  const [busy, startTransition] = useTransition();
  const step = (id: string, delta: number, size?: string) =>
    startTransition(async () => {
      setError(null);
      addOptimistic({ id, delta, size });
      // A failed save or an offline tap says so; the optimistic step drops with the transition.
      const result = await safeAction(() => adjustStock(id, delta, size));
      if (result.error) setError(result.error);
    });

  const count = (id: string, amount: number) =>
    startTransition(async () => {
      setError(null);
      addOptimistic({ id, count: amount });
      const result = await safeAction(() => countStock(id, amount));
      if (result.error) setError(result.error);
    });

  const locationName = new Map(locations.map((l) => [l.id, l.name]));
  const locationOf = (i: Item) =>
    i.locationId ??
    lookups.groups.find((g) => g.id === i.groupId)?.locationId ??
    null;
  // The shop map (Harel, 2026-11-14): each zone's and drawer's items, categories and short ones.
  const [mapOpen, setMapOpen] = useState(false);
  const placeById = useMemo(() => placeIndex(locations), [locations]);
  const activeLocation = placeById.get(locationId);
  const inLocation = (i: Item) => !locationId || inPlace(locationOf(i), locationId, placeById);
  const mapStats = useMemo(
    () =>
      placeStats(
        optimistic.map((i) => ({ id: i.id, name: i.name, category: i.category, place: locationOf(i), short: standing(i, "any") === "short" })),
        locations,
        categories,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locationOf follows the groups
    [optimistic, lookups.groups, locations, categories],
  );
  // On a computer the map sits docked above the page and a tap on its empty floor opens it as a
  // window (like BOM 3D previews); on phones and tablets the Map button opens the window. A place picked there filters the page (?loc=) and
  // shows as a ✕ chip.
  const desktop = useDesktop();
  const pickPlace = (id: string | null) => setLocationId(!id || locationId === id ? "" : id);
  const filterChip = activeLocation && (
    <button
      type="button"
      onClick={() => setLocationId("")}
      className="press flex shrink-0 items-center gap-1.5 rounded-full border border-accent bg-accent px-3 py-1.5 text-xs font-semibold text-white active:scale-[0.98]"
      title="Clear the place filter"
    >
      <span className="h-2.5 w-2.5 rounded-full border border-white/70" style={{ background: zoneColor(zoneOf(activeLocation.id, placeById)) }} />
      {placeWord(activeLocation)} ✕
    </button>
  );
  const mapButton = (
    <div className="flex shrink-0 items-center gap-1.5 self-start">
      {!desktop && (
        <button type="button" onClick={() => setMapOpen(true)} className="btn min-h-12 active:scale-[0.98]" title="Open the shop map">
          <Icon name="map" className="h-4 w-4" /> Map
        </button>
      )}
      {filterChip}
    </div>
  );
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
        ? inPlace(locationOf(i), scope.id, placeById)
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
  // Short for Season / Robots can hold several categories at once (?cat=a,b); otherwise one.
  const cats = group ? (params.get("cat") ?? "").split(",").filter(Boolean) : [];
  const catSet = new Set(cats);
  const cat = cats.length === 1 ? cats[0] : null;
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
    (catSet.size === 0 || catSet.has(i.category));
  const red = (i: Item) => standing(i, need) === "short";

  // In a category: a labeled row of pills per spec field (Bearings: ID, OD, Thick, Type),
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
  const rankAdded = (i: Item) => {
    if (saving(i.id)) return -1;
    const n = added.indexOf(i.id);
    return n < 0 ? added.length : n;
  };
  const shown = optimistic
    .filter(
      (i) =>
        inScope(i) &&
        inView(i) &&
        inBox(i) &&
        inSub(i) &&
        matches(i) &&
        (!conditionId || i.conditionId === conditionId) &&
        inLocation(i),
    )
    .sort((a, b) =>
      view ? RANK[standing(a, view)] - RANK[standing(b, view)] : 0,
    )
    .sort((a, b) => rankAdded(a) - rankAdded(b));
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
          inLocation(i),
      )
    : [];
  const showBoxes = home && (!query || !!view);
  // "Other" gets no box here; its items fold above Recent actions instead (Harel, 2026-10-29).
  const noOther = useMemo(() => categories.filter((c) => c.id !== "other"), [categories]);
  const otherItems = boxes
    ? optimistic.filter((i) => i.category === "other" && inBox(i))
    : [];
  // Home's folded All items: with a group open, only that group's items (Harel, 2026-11-11).
  const allItems = boxes ? optimistic.filter(inBox) : [];

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
  // On phones the Condition choice lives in the Filters panel instead of its own select.
  const condFilter: CondFilter | null =
    phone && conditions.length > 0
      ? {
          conditions,
          value: conditionId,
          counts: (focusCat ? catItems : optimistic).reduce<Record<string, number>>((m, i) => {
            if (i.conditionId) m[i.conditionId] = (m[i.conditionId] ?? 0) + 1;
            return m;
          }, {}),
          onChange: setConditionId,
        }
      : null;
  const clearFilters = () => {
    setSpecPick(null);
    if (condFilter) setConditionId("");
  };
  const filters = (
    <div className="hidden w-full gap-2 sm:flex sm:w-auto">
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
    </div>
  );
  const pick = (m: "select" | "move" | "delete") => {
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
  // Long press: that item selected, the bar offering Edit / Move / Delete; taps add more.
  const hold = useLongPress<string>({
    enabled: edit && picking === null,
    find: (t, area) => holdTarget(t, area, "[data-item]")?.dataset.item ?? null,
    onHold: (id) => {
      if (saving(id)) return;
      setPicking("select");
      setSelected(new Set([id]));
      setMoveCat("");
      setMoveLoc("");
      setNotice(null);
    },
  });
  const editSelected = () => {
    const id = [...selected][0];
    setPicking(null);
    setSelected(new Set());
    openItem(id, optimistic.find((i) => i.id === id), { edit: true });
  };
  const confirmMove = () => {
    const ids = [...selected];
    const target = {
      ...(moveCat && { category: moveCat }),
      ...(moveLoc && { locationId: moveLoc === "none" ? null : moveLoc }),
    };
    startTransition(async () => {
      setError(null);
      done(await safeAction(() => bulkMoveItems(ids, target)));
    });
  };
  const confirmDelete = async () => {
    const ids = [...selected];
    const used = optimistic.filter(
      (i) => selected.has(i.id) && i.usage?.parts.length,
    ).length;
    const warn = used
      ? `${used} of them ${used === 1 ? "is" : "are"} linked to BOM parts. `
      : "";
    if (
      !(await askConfirm({
        title: `Delete ${ids.length} item${ids.length === 1 ? "" : "s"} from the inventory?`,
        body: `${warn}${ids.length === 1 ? "It stays" : "They stay"} in Settings → Recently deleted for 30 days.`,
        confirm: "Delete",
        danger: true,
      }))
    )
      return;
    startTransition(async () => {
      setError(null);
      done(await safeAction(() => bulkDeleteItems(ids)));
    });
  };

  // Cards | List | Table, remembered in this browser.
  const layoutSaved = useSyncExternalStore(
    foldStore.subscribe,
    () => foldStore.read(LAYOUT_KEY),
    () => null,
  );
  const layout: Layout = layoutSaved === "table" || layoutSaved === "list" ? layoutSaved : "cards";
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
  // At the search row's right end, the page's top right (Harel, 2026-11-13).
  const layoutSwitch = <ViewPicker label="Show items as" options={LAYOUTS} value={layout} onChange={setLayout} />;

  const grid = (list: Item[], cardView: NeedView = need, hideSeason = false) =>
    layout === "table" ? (
      <div className="hold-area">
      <ItemTable
        items={list}
        categories={categories}
        conditions={conditions}
        locations={locations}
        locationOf={locationOf}
        view={cardView}
        hideCategory={scope.kind === "category" || !!cat}
        hideSeason={hideSeason}
        onStep={step}
        onCount={count}
        selected={selected}
        onToggleSelect={selecting ? toggleSelected : undefined}
        glowOf={glowOf}
      />
      </div>
    ) : layout === "list" ? (
      <div className="list-stack hold-area">
        {list.map((item) => (
          <ItemListRow
            key={item.id}
            item={item}
            categories={categories}
            condition={conditions.find((c) => c.id === item.conditionId)}
            location={locations.find((l) => l.id === locationOf(item))}
            conditions={conditions}
            locations={locations}
            onStep={(d, b) => step(item.id, d, b)}
            onCount={(n) => count(item.id, n)}
            view={cardView}
            hideCategory={scope.kind === "category" || !!cat}
            hideSeason={hideSeason}
            selected={selected.has(item.id)}
            onToggleSelect={selecting ? () => toggleSelected(item.id) : undefined}
            glow={glowOf(item.id)}
          />
        ))}
      </div>
    ) : (
      <div
        className="card-grid hold-area"
        style={{ "--card-min": "220px" } as React.CSSProperties}
      >
        {list.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            categories={categories}
            condition={conditions.find((c) => c.id === item.conditionId)}
            location={locations.find((l) => l.id === locationOf(item))}
            locations={locations}
            placeStats={mapStats}
            view={cardView}
            onStep={(d, b) => step(item.id, d, b)}
            onCount={(n) => count(item.id, n)}
            hideCategory={scope.kind === "category" || !!cat}
            hideSeason={hideSeason}
            selected={selected.has(item.id)}
            onToggleSelect={
              selecting ? () => toggleSelected(item.id) : undefined
            }
            glow={glowOf(item.id)}
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
    <div className={`space-y-4 ${selecting ? "pb-20" : ""}`} {...hold}>
      <EditOnly>
        {/* Phones open on the search and the shelf: the spreadsheet, Move and Delete wait behind
            ⋮ (they're shown while Move or Delete is picking, to end it). */}
        {!toolsOpen && !picking && (
          // Pulled up beside the page's heading, so it takes no row of its own.
          <div className="-mt-[3.25rem] flex justify-end sm:hidden">
            <IconButton label="Spreadsheet, move and delete" tone="outline" onClick={() => setToolsOpen(true)}>
              <Icon name="more" className="h-5 w-5" />
            </IconButton>
          </div>
        )}
        <div className={`panel flex-wrap items-center gap-2 p-3 ${toolsOpen || picking ? "flex" : "hidden sm:flex"}`}>
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

      {desktop && (
        <ShopMap
          places={locations}
          stats={mapStats}
          selectedId={locationId || null}
          onFilter={pickPlace}
          className="h-[clamp(11rem,26vh,17rem)] w-full"
          onTapEmpty={() => setMapOpen(true)}
        />
      )}

      {/* The search row stays under the top bar while the list scrolls. */}
      {/* On phones the box and Scan get the whole first row and the filters the next. */}
      <div className="sticky top-[var(--topbar-h)] z-20 -mx-2 flex flex-wrap gap-2 bg-ink/95 px-2 py-2 backdrop-blur">
        <div className="flex w-full min-w-0 gap-2 sm:contents">
          <AddBox
            ref={addBox}
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
            onAdded={onAdded}
            onAdding={(item) => addOptimistic({ add: item })}
            onFocusChange={setBoxFocus}
          />
          <ScanButton onCode={setQ} onNew={(over) => addBox.current?.start(over)} items={items} categories={categories} show={phone && boxFocus} />
          {mapButton}
        </div>
        {!boxes && !showBoxes && filters}
        <div className="ml-auto self-center">{layoutSwitch}</div>
      </div>

      {/* The shop map as a window: the Map button on phones, a tap on the docked map on a computer.
          "Show these items" filters the page and closes it. */}
      <Dialog
        open={mapOpen}
        onClose={() => setMapOpen(false)}
        width="w-[min(80rem,calc(100vw-1rem))]"
        title={
          <span className="flex items-center gap-2">
            <Icon name="map" className="h-4 w-4 text-accent" /> Shop map
            {filterChip}
          </span>
        }
      >
        {mapOpen && (
          <ShopMap
            places={locations}
            stats={mapStats}
            selectedId={locationId || null}
            find={desktop ? null : locationId || null}
            onFilter={(id) => {
              setMapOpen(false);
              pickPlace(id);
            }}
            className="h-[min(74dvh,46rem)] w-full"
          />
        )}
      </Dialog>

      {error && (
        <Notice tone="error">
          Couldn&apos;t save: {error}
        </Notice>
      )}
      {notice && !error && (
        <Notice tone="success" className="flex items-center gap-2">
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            className="press"
            aria-label="Dismiss"
            onClick={() => setNotice(null)}
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </Notice>
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
                // Leaving the view keeps one category at most (outside it a box picks just one).
                onClick={() => pushQuery({ view: on ? null : t.id, ...(on && cats.length > 1 ? { cat: null } : {}) })}
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
          categories={noOther}
          counts={counts}
          group={group}
          category={cat}
          picked={view ? catSet : undefined}
          onGroup={(g) => pushQuery({ group: g, cat: null })}
          onCategory={(c) => {
            if (!view || !c) return pushQuery({ cat: c });
            const next = new Set(catSet);
            if (next.has(c)) next.delete(c);
            else next.add(c);
            pushQuery({ cat: [...next].join(",") || null });
          }}
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
              No inventory yet. Add items one by one or import a
              spreadsheet.
            </div>
          )}

          {otherItems.length > 0 && (
            <Fold
              id="other-items"
              title={`Other (${otherItems.length})`}
              defaultOpen={false}
            >
              {grid(otherItems)}
            </Fold>
          )}
          <Fold id="recent" title="Recent actions" defaultOpen={false}>
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
          {allItems.length > 0 && (
            <Fold id="all" title={`All items (${allItems.length})`}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {filters}
                <select
                  value={season}
                  onChange={(e) => setSeason(e.target.value as typeof season)}
                  aria-label="Season"
                  className="input min-h-12 w-auto min-w-0 self-start"
                >
                  <option value="">Any season</option>
                  <option value="2026">2026</option>
                  <option value="2027">2027</option>
                </select>
                {condFilter && <SpecFilterBar rows={[]} picks={{}} cond={condFilter} open={filtersOpen} onToggle={toggleFilters} onPick={togglePick} onClear={clearFilters} />}
                <span className="ml-auto" />
                {!edit && !hideExport && exportButton}
              </div>
              {filtersOpen && condFilter && (
                <div className="mb-3">
                  <SpecFilterRows rows={[]} picks={{}} cond={condFilter} onPick={togglePick} />
                </div>
              )}
              {grid(
                allItems.filter(
                  (i) =>
                    (!conditionId || i.conditionId === conditionId) &&
                    (!season || i.seasonTag === season) &&
                    inLocation(i),
                ),
                need,
                !!season,
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
            {(specRows.length > 0 || condFilter) && <SpecFilterBar rows={specRows} picks={picks} cond={condFilter} open={filtersOpen} onToggle={toggleFilters} onPick={togglePick} onClear={clearFilters} />}
            {showBoxes && filters}
            <span className="ml-auto" />
            {!edit && !hideExport && exportButton}
          </div>
          {filtersOpen && (specRows.length > 0 || condFilter) && <SpecFilterRows rows={specRows} picks={picks} cond={condFilter} onPick={togglePick} />}
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
          ) : scope.kind === "category" && shownMain.some((i) => i.seasonTag === "2026") ? (
            // A category page keeps last season's items (tagged 2026) folded under this season's,
            // closed at first (Harel, 2026-11-04).
            <>
              {shownMain.some((i) => i.seasonTag !== "2026") && grid(shownMain.filter((i) => i.seasonTag !== "2026"))}
              <div className="pt-2">
                <Fold id={`season-2026-${scope.id}`} title={`2026 items (${shownMain.filter((i) => i.seasonTag === "2026").length})`} defaultOpen={false}>
                  {grid(shownMain.filter((i) => i.seasonTag === "2026"))}
                </Fold>
              </div>
            </>
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
            {selecting === "select" ? (
              <>
                <span className="ml-auto" />
                <button
                  className="btn min-h-11 active:scale-[0.98]"
                  disabled={selected.size !== 1}
                  title={selected.size === 1 ? undefined : "Edit works on one item at a time"}
                  onClick={editSelected}
                >
                  <Icon name="pencil" className="h-4 w-4" /> Edit
                </button>
                <button
                  className="btn min-h-11 active:scale-[0.98]"
                  disabled={selected.size === 0}
                  onClick={() => setPicking("move")}
                >
                  Move
                </button>
                <button
                  className="btn min-h-11 text-rose-600 active:scale-[0.98]"
                  disabled={busy || selected.size === 0}
                  onClick={confirmDelete}
                >
                  Delete
                </button>
              </>
            ) : selecting === "move" ? (
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
                <LocationPicker
                  locations={locations}
                  value={moveLoc && moveLoc !== "none" ? moveLoc : null}
                  onChange={(id) => setMoveLoc(id ?? "")}
                  choices={[
                    { value: "", label: "Keep location" },
                    { value: "none", label: "No location" },
                  ]}
                  ariaLabel="Move to location"
                  className="input min-h-11 w-auto py-1.5 text-left text-sm active:scale-[0.98]"
                >
                  {moveLoc === "none"
                    ? "No location"
                    : (locations.find((l) => l.id === moveLoc)?.name ?? "Location: keep")}
                </LocationPicker>
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

type Layout = "cards" | "list" | "table";
const LAYOUT_KEY = "orbit-inventory-layout";
const LAYOUTS: { value: Layout; label: string }[] = [
  { value: "cards", label: "Cards" },
  { value: "list", label: "List" },
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
type CondFilter = { conditions: Condition[]; value: string; counts: Record<string, number>; onChange: (id: string) => void };

function SpecFilterBar({
  rows,
  picks,
  cond,
  open,
  onToggle,
  onPick,
  onClear,
}: {
  rows: SpecGroup[];
  picks: SpecPicks;
  cond: CondFilter | null;
  open: boolean;
  onToggle: () => void;
  onPick: (fieldId: string, key: string) => void;
  onClear: () => void;
}) {
  const active = rows.flatMap((g) => {
    const v = g.values.find((x) => x.key === picks[g.field.id]);
    return v ? [{ g, v }] : [];
  });
  const activeCond = cond?.conditions.find((c) => c.id === cond.value);
  const total = active.length + (activeCond ? 1 : 0);
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`press inline-flex min-h-9 items-center gap-1 rounded-full border pr-3 pl-1.5 text-xs font-semibold transition-colors duration-150 hover:border-sky-400/40 ${total ? "border-accent text-accent" : "border-line-strong text-fg-2"}`}
      >
        <Chevron open={open} small className="hover:bg-transparent" />
        Filters
        {total > 0 && <span className="ml-0.5 rounded-full bg-accent px-1.5 font-mono text-[0.625rem] text-white tabular-nums">{total}</span>}
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
            <span className="text-[0.625rem] tracking-wider uppercase opacity-75">{g.label}</span>
            {v.label}
            <Icon name="close" className="h-3 w-3" />
          </button>
        ))}
      {!open && cond && activeCond && (
        <button
          type="button"
          onClick={() => cond.onChange("")}
          title={`Remove Condition: ${activeCond.label}`}
          className="press inline-flex min-h-9 items-center gap-1.5 rounded-full border border-accent bg-accent px-3 text-xs font-semibold text-white"
        >
          <span className="text-[0.625rem] tracking-wider uppercase opacity-75">Condition</span>
          {activeCond.label}
          <Icon name="close" className="h-3 w-3" />
        </button>
      )}
      {total > 0 && (
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
function SpecFilterRows({ rows, picks, cond, onPick }: { rows: SpecGroup[]; picks: SpecPicks; cond: CondFilter | null; onPick: (fieldId: string, key: string) => void }) {
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
      {cond && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-full shrink-0 text-[0.625rem] font-semibold tracking-wider text-subtle uppercase sm:w-20">Condition</span>
          {cond.conditions.map((c) => (
            <SubPill key={c.id} on={cond.value === c.id} onClick={() => cond.onChange(cond.value === c.id ? "" : c.id)}>
              {c.label}
              <span className="ml-1.5 font-mono text-[0.625rem] tabular-nums opacity-60">{cond.counts[c.id] ?? 0}</span>
            </SubPill>
          ))}
        </div>
      )}
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
                className="press flex w-full shrink-0 items-center gap-0.5 text-left text-[0.625rem] font-semibold tracking-wider text-subtle uppercase hover:text-fg sm:w-20"
              >
                {g.label}
                <Icon name="chevron" className={`h-3 w-3 transition-transform duration-150 ${all ? "rotate-90" : ""}`} />
              </button>
            ) : (
              <span className="w-full shrink-0 text-[0.625rem] font-semibold tracking-wider text-subtle uppercase sm:w-20">{g.label}</span>
            )}
            {shown.map((v) => (
              <SubPill key={v.key} on={picks[g.field.id] === v.key} onClick={() => onPick(g.field.id, v.key)}>
                {v.label}
                <span className="ml-1.5 font-mono text-[0.625rem] tabular-nums opacity-60">{v.count}</span>
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
