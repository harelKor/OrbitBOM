"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useOptimistic, useState, useTransition } from "react";
import { COTS_ARRIVED, COTS_IN_STOCK, COTS_ORDERED, COTS_RELEASED, IN_STOCK_SHOWN_DAYS, ORDER_STATUSES, getCotsStatus } from "@/config/cots";
import { CATEGORY_GROUPS, groupOf, isCategoryGroup, type CategoryGroupId } from "@/config/inventory";
import { addCotsFromItem, clearInStock, removeFromCotsCart, saveCotsCart, updateCotsParts } from "@/app/(app)/cots/actions";
import { BomProvider, useBom } from "@/components/bom/BomContext";
import { PartStage, type StageView } from "@/components/dashboard/PartStage";
import { AddBox } from "@/components/inventory/AddBox";
import { useInventoryPopup } from "@/components/inventory/InventoryPopup";
import type { Condition, InvCategory, Item, Location } from "@/components/inventory/types";
import { useCan, useManage, useMode } from "@/components/shell/ModeContext";
import { statusDenied } from "@/components/shell/mode";
import { useEscape } from "@/components/ui/useEscape";
import { statusTint } from "@/components/ui/statusTint";
import { StatusField } from "@/components/bom/fields";
import { Thumb } from "@/components/bom/Thumb";
import { ownerPartId, partTitle, type CardPart } from "@/components/bom/types";
import { CategoryBoxes, pushQuery } from "@/components/ui/CategoryBoxes";
import { Chevron } from "@/components/ui/Chevron";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { cotsTotal, groupSameCots, siteOf, spreadCotsChanges } from "@/lib/cots";
import { planPartUpdate, type PartChanges } from "@/lib/parts/changes";
import { computeStatus } from "@/lib/status";
import type { CotsCart } from "@/lib/data/cotsCarts";
import { OpenBatchContext } from "@/components/fab/BatchCard";
import { CartCard } from "./CartCard";
import { CotsCard, OrderStatusButton } from "./CotsCard";
import { PartList, PartListRow } from "@/components/bom/PartListRow";
import { useStoredChoice } from "@/components/ui/useStoredChoice";
import { formatPrice, useCurrency } from "./currency";
import { SheetViewport } from "@/components/ui/SheetViewport";

// robotId null: the General section (a card added on the COTS page for no robot).
export type CotsViewPart = CardPart & { robotId: string | null; robotName: string | null; cotsInStockAt: Date | null; cotsClearedAt: Date | null; category: string };
// The shelf, for Released's search box.
export type CotsShelf = { items: Item[]; categories: InvCategory[]; locations: Location[]; conditions: Condition[] };
type Edit = { id: string; changes: PartChanges };
// One card: a part, or the same part from several systems (members) shown with the total amount.
type Row = { key: string; part: CardPart; members: CardPart[] };
// Dragging cards between Released's robot sections and its In order list section.
const DRAG_TYPE = "application/x-orbit-cots";
type DragLoad = { ids: string[]; from: "list" | "ordered" };
type Place = { robotId: string | null; name: string };

const groupLabel = (id: CategoryGroupId) => CATEGORY_GROUPS.find((g) => g.id === id)!.label;
// Where a Released card came from: a robot's BOM (or a robot's section), or General.
const originOf = (p: CardPart): "General" | "Robot" => (p.systemId || (p as CotsViewPart).robotId ? "Robot" : "General");
const ORDERING = ORDER_STATUSES.filter((s) => s !== COTS_IN_STOCK) as string[];
// The Order List's top sections and status filters: Arrived parts get their own section instead.
const ORDER_FILTERS = ORDERING.filter((s) => s !== COTS_ARRIVED);
// The statuses the Status bar can set on the selected cards.
const BULK_STATUSES: string[] = [COTS_RELEASED, ...ORDER_STATUSES];
const SHOWN_MS = IN_STOCK_SHOWN_DAYS * 24 * 60 * 60 * 1000;
const NO_VENDOR = "No vendor";
const vendorOf = (p: CardPart) => (p.cotsLinks?.[0] ? siteOf(p.cotsLinks[0]) : NO_VENDOR);

function shelfOf(members: CardPart[]) {
  const first = members.find((m) => m.shelf)?.shelf;
  if (!first) return null;
  const same = members.filter((m) => m.shelf?.itemId === first.itemId);
  return { ...first, covered: same.reduce((n, m) => n + (m.shelf?.covered ?? 0), 0) };
}

// The COTS page's Released and Order List: compact filter boxes on top (the inventory's groups,
// then a group's categories, kept in ?group=&cat=), then a General section
// (parts that belong to no robot) and one section per robot, or one per vendor, as cards or a
// table. Released has a search box that adds shelf items or new products as cards, and Send to
// order; the Order List has status filters, and a part set In Stock there is crossed out and
// moves down to In stock once the page is left. The In stock sections show a part for a week after
// it arrived, or until its X. ?part=<id> (the cart on an Inventory card) scrolls to that card and
// makes it glow. On the Order List, Cart picks parts from one vendor and makes them a cart (or
// adds them to one of that vendor's), shown on top like a Shop Fab batch until none of its parts
// is left on the list; its cart button opens the vendor's site with them in its cart.
export function CotsView({
  list,
  parts,
  robots,
  categories,
  carts = [],
  shelf,
}: {
  list: "released" | "order";
  parts: CotsViewPart[];
  robots: { id: string; name: string }[];
  categories: InvCategory[];
  carts?: CotsCart[];
  shelf?: CotsShelf;
}) {
  const edit = useManage();
  const work = useCan("work");
  const { mode } = useMode();
  // The statuses this team may set on many cards at once, and whether it sends cards to order.
  const bulkStatuses = BULK_STATUSES.filter((s) => !statusDenied(mode, s, { cots: true }));
  const canOrder = !statusDenied(mode, COTS_ORDERED, { cots: true });
  const [optimistic, addOptimistic] = useOptimistic(parts, (state, edits: Edit[]) =>
    state.map((p) => {
      const e = edits.find((x) => x.id === p.id);
      return e ? { ...p, ...planPartUpdate(p, e.changes, "ui").set } : p;
    }),
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Parts set In Stock on this visit stay in place, crossed out.
  const [struck, setStruck] = useState<Set<string>>(new Set());
  const [arrivedStruck, setArrivedStruck] = useState<Set<string>>(new Set());
  // Parts whose X was pressed on this visit, gone before the server answers.
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [now] = useState(() => Date.now());
  const params = useSearchParams();
  const rawGroup = params.get("group");
  const group: CategoryGroupId | null = rawGroup && isCategoryGroup(rawGroup) ? rawGroup : null;
  const category = group ? params.get("cat") : null;
  const groupOfCat = new Map(categories.map((c) => [c.id, c.group]));
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  // Cards, List (rows, made for phones) or Table, remembered by this browser.
  const [view, setView] = useStoredChoice("orbit-cots-view", ["cards", "list", "table"] as const, "cards");
  const [byVendor, setByVendor] = useState(false);
  // Vendors: a box per vendor on top; a box shows only that vendor's section (Harel, 2026-11-04).
  const [vendorPick, setVendorPick] = useState<string | null>(null);
  // Picking cards: "order" (Released's Send to order), "status" (set one status on all of them) or
  // "cart" (the Order List's Cart: parts from one vendor).
  const [selecting, setSelecting] = useState<"order" | "status" | "cart" | null>(null);
  const ordering = selecting !== null;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set()); // groups shown per system
  const [addTo, setAddTo] = useState<string>(""); // "" = General, else a robot id
  const [cartTarget, setCartTarget] = useState(""); // "" = a new cart, else a cart id
  const [openCart, setOpenCart] = useState<string | null>(null); // one open cart, as with packs

  const places: Place[] = [{ robotId: null, name: "General" }, ...robots.map((r) => ({ robotId: r.id, name: r.name }))];

  function save(edits: Edit[]) {
    if (!edits.length) return;
    setError(null);
    if (list === "order") {
      setStruck((s) => {
        const next = new Set(s);
        for (const e of edits) {
          if (e.changes.status === COTS_IN_STOCK) {
            next.add(e.id);
            if (optimistic.some((p) => p.id === e.id && computeStatus(p) === COTS_ARRIVED)) setArrivedStruck((a) => new Set(a).add(e.id));
          }
          else if (e.changes.status) next.delete(e.id);
        }
        return next;
      });
    }
    startTransition(async () => {
      addOptimistic(edits);
      const r = await updateCotsParts(edits);
      if (r.error) {
        setError(r.error);
        // Nothing saved: the cards it crossed out come back as they were.
        const ids = new Set(edits.map((e) => e.id));
        setStruck((s) => new Set([...s].filter((id) => !ids.has(id))));
        setArrivedStruck((s) => new Set([...s].filter((id) => !ids.has(id))));
      }
    });
  }
  const saveRow = (row: Row) => (changes: PartChanges) =>
    save(row.members.length === 1 ? [{ id: row.members[0].id, changes }] : spreadCotsChanges(row.members, changes));
  // A card linked to an inventory item opens the item's window with its order (Need to Order and
  // the order status); a card with no item still opens the part's window.
  const { openItem } = useInventoryPopup();
  const openRow = (row: Row) => {
    const p = row.part;
    const itemId = p.shelf?.itemId ?? p.inventoryItemId;
    if (!itemId) return undefined;
    return () =>
      openItem(itemId, undefined, {
        cotsOrder: {
          info: { quantity: p.quantity, status: computeStatus(p), links: p.cotsLinks ?? [], unitPrice: p.unitPrice, sentBack: p.cotsSentBack ?? null, deliveryDate: p.cotsDeliveryDate ?? null, grouped: row.members.length > 1 },
          save: saveRow(row),
        },
      });
  };
  const clear = (ids: string[]) => {
    setCleared((s) => new Set([...s, ...ids]));
    startTransition(async () => {
      const r = await clearInStock(ids);
      if (r.error) {
        setError(r.error);
        setCleared((s) => new Set([...s].filter((id) => !ids.includes(id))));
      }
    });
  };
  const addItem = (itemId: string) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const r = await addCotsFromItem(itemId, addTo || null);
      if (r.error) setError(r.error);
      else setNotice(r.message ?? null);
    });
  };

  const inList = (p: CardPart) => {
    const s = computeStatus(p);
    return list === "released" ? s === COTS_RELEASED : ORDERING.includes(s) || (s === COTS_IN_STOCK && struck.has(p.id));
  };
  const shownInStock = (p: CotsViewPart) =>
    computeStatus(p) === COTS_IN_STOCK && !p.cotsClearedAt && !cleared.has(p.id) && (!p.cotsInStockAt || now - new Date(p.cotsInStockAt).getTime() < SHOWN_MS);
  const ofCategory = (p: CotsViewPart) => (!group || groupOf(groupOfCat.get(p.category)) === group) && (!category || p.category === category);
  const ofStatus = (p: CardPart) => list !== "order" || !statusFilter || computeStatus(p) === statusFilter || struck.has(p.id);
  const listed = optimistic.filter(inList);
  const cartOf = new Map<string, CotsCart>();
  for (const c of list === "order" ? carts : []) for (const id of c.partIds) cartOf.set(id, c);
  // Arrived parts (and ones set In Stock from there on this visit) sit in the Order List's Arrived section.
  const isArrived = (p: CardPart) => list === "order" && (computeStatus(p) === COTS_ARRIVED || (struck.has(p.id) && arrivedStruck.has(p.id)));
  const main = listed.filter((p) => ofCategory(p) && ofStatus(p) && !isArrived(p) && !cartOf.has(p.id));
  const arrived = listed.filter((p) => ofCategory(p) && isArrived(p) && !cartOf.has(p.id));
  // A cart shows while any of its parts is on the list (and passes the filters), with all of those.
  const shownCarts = (list === "order" ? carts : [])
    .map((cart) => ({ cart, members: listed.filter((p) => cartOf.get(p.id)?.id === cart.id) }))
    .filter((c) => c.members.some((p) => ofCategory(p) && ofStatus(p)));
  const inStock = optimistic.filter((p) => shownInStock(p) && !struck.has(p.id) && ofCategory(p));
  const counts = new Map<string, { count: number }>();
  for (const p of listed)
    for (const key of [p.category, groupOf(groupOfCat.get(p.category))]) counts.set(key, { count: (counts.get(key)?.count ?? 0) + 1 });

  // ?part=<id>: clear a box filter that would hide it, then scroll to its card and let it glow.
  const target = params.get("part");
  useEffect(() => {
    if (!target) return;
    const part = parts.find((p) => p.id === target);
    if (part && !ofCategory(part)) pushQuery({ group: null, cat: null });
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-part~="${CSS.escape(target)}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.dataset.glow = "1";
      setTimeout(() => delete el.dataset.glow, 4000);
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per target
  }, [target]);
  const statusCounts = new Map<string, number>();
  for (const p of listed) if (ofCategory(p)) statusCounts.set(computeStatus(p), (statusCounts.get(computeStatus(p)) ?? 0) + 1);

  const rowsOf = (ps: CotsViewPart[]): Row[] =>
    groupSameCots(ps).map((members) => {
      if (members.length === 1) return { key: members[0].id, part: members[0], members };
      const [first] = members;
      const sum = (f: "quantity" | "stockCount") => members.reduce((n, m) => n + m[f], 0);
      return {
        key: `cots:${first.id}`,
        members,
        part: {
          ...first,
          id: `cots:${first.id}`,
          quantity: sum("quantity"),
          stockCount: sum("stockCount"),
          // The shelf of the first member with an item, covering every member on that item.
          shelf: shelfOf(members),
          shelfSuggestion: members.find((m) => m.shelfSuggestion)?.shelfSuggestion ?? null,
          memberIds: members.map((m) => m.id),
          systemName: [...new Set(members.map((m) => m.systemName).filter(Boolean))].join(", "),
        },
      };
    });

  const toggle = <T,>(set: Set<T>, v: T) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  // On Released, cards slide between the robot sections and the In order list section.
  const draggable = work && list === "released" && !ordering;
  const dragProps = (ids: string[], from: DragLoad["from"]) =>
    draggable
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.stopPropagation();
            e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ ids, from } satisfies DragLoad));
          },
        }
      : {};
  const dropTo = (to: DragLoad["from"]) => (load: DragLoad) => {
    if (load.from === to || !load.ids.length) return;
    save(load.ids.map((id) => ({ id, changes: to === "ordered" ? { status: COTS_ORDERED, cotsSentBack: null } : { status: COTS_RELEASED } })));
  };

  const renderRows = (
    rows: Row[],
    { small = false, from = "list", clearable: canClear = false }: { small?: boolean; from?: DragLoad["from"]; clearable?: boolean } = {},
  ) => {
    const clearable = canClear && work;
    return (
    view === "table" ? (
      <CotsTable rows={rows} saveRow={saveRow} struck={struck} orderList={list === "order" && !small} onClear={clearable ? clear : undefined} />
    ) : view === "list" ? (
      <PartList>
        {rows.map((row) => {
          const ids = row.members.map((m) => m.id);
          return (
            <div key={row.key} className={`relative ${row.members.every((m) => struck.has(m.id)) ? "opacity-60" : ""} ${dim(row)}`} {...dragProps(ids, from)}>
              <PartListRow
                part={row.part}
                save={saveRow(row)}
                selected={selected.has(row.key)}
                onToggleSelect={pick(row)}
                onOpen={openRow(row)}
              />
              {clearable && <ClearButton name={partTitle(row.part)} onClick={() => clear(ids)} />}
            </div>
          );
        })}
      </PartList>
    ) : (
      <div className="card-grid" style={{ "--card-min": small ? "200px" : list === "order" ? "300px" : "220px" } as React.CSSProperties}>
        {rows.map((row) => {
          const grouped = row.members.length > 1;
          const crossed = row.members.every((m) => struck.has(m.id));
          const variant = list === "order" && !small ? "order" : "default";
          const ids = row.members.map((m) => m.id);
          if (grouped && open.has(row.key) && !ordering)
            return (
              <GroupBox key={row.key} row={row} onClose={() => setOpen((s) => toggle(s, row.key))} {...dragProps(ids, from)}>
                {row.members.map((m) => (
                  <div key={m.id} {...dragProps([m.id], from)}>
                    <CotsCard part={m} save={saveRow({ key: m.id, part: m, members: [m] })} onOpen={openRow({ key: m.id, part: m, members: [m] })} showSystem highlightSystem variant={variant} shelfOnThumb struck={struck.has(m.id)} />
                  </div>
                ))}
              </GroupBox>
            );
          return (
            <div key={row.key} className={`relative ${dim(row)}`} {...dragProps(ids, from)}>
              <CotsCard
                part={row.part}
                save={saveRow(row)}
                onOpen={openRow(row)}
                showSystem
                variant={variant} shelfOnThumb
                origin={list === "released" ? originOf(row.members[0]) : undefined}
                struck={crossed}
                group={grouped && !ordering ? { systems: new Set(row.members.map((m) => m.systemId)).size, onOpen: () => setOpen((s) => toggle(s, row.key)) } : undefined}
                selected={selected.has(row.key)}
                onToggleSelect={pick(row)}
              />
              {clearable && <ClearButton name={partTitle(row.part)} onClick={() => clear(ids)} />}
            </div>
          );
        })}
      </div>
    ));
  };

  // A list split by General and robot, each with a small heading (for the small sections and
  // the vendor sections).
  const byPlace = (ps: CotsViewPart[], opts: Parameters<typeof renderRows>[1] = {}) =>
    places.map((place) => {
      const rows = rowsOf(ps.filter((p) => p.robotId === place.robotId));
      return rows.length ? (
        <BomProvider key={place.robotId ?? "general"} value={{ inventory: [], isAdmin: false, robotId: place.robotId ?? undefined }}>
          <div className="space-y-2">
            <div className="text-xs font-semibold text-subtle">{place.name}</div>
            {renderRows(rows, opts)}
          </div>
        </BomProvider>
      ) : null;
    });

  const placeRows = places.map((place) => ({ place, rows: rowsOf(main.filter((p) => p.robotId === place.robotId)) }));
  const allRows = placeRows.flatMap((r) => r.rows);
  // Cart: the first card picked sets the vendor; only cards with a link from it can join.
  const cartPick = selecting === "cart" ? (allRows.find((r) => selected.has(r.key)) ?? null) : null;
  const cartVendor = cartPick && vendorOf(cartPick.part);
  // Only the list's own cards: a cart's are picked from (and moved by) the list.
  const listKeys = new Set(allRows.map((r) => r.key));
  const pickable = (row: Row) =>
    selecting !== "cart" || (listKeys.has(row.key) && !row.members.some((m) => cartOf.has(m.id)) && vendorOf(row.part) !== NO_VENDOR && (!cartVendor || vendorOf(row.part) === cartVendor));
  const pick = (row: Row) => (ordering && pickable(row) ? () => setSelected((s) => toggle(s, row.key)) : undefined);
  const dim = (row: Row) => (ordering && !pickable(row) ? "opacity-40" : "");
  const vendors = [...new Set(main.map(vendorOf))].sort((a, b) => (a === NO_VENDOR ? 1 : b === NO_VENDOR ? -1 : a.localeCompare(b)));
  // Released: the parts already on the order list, in a small section below.
  const queued = list === "released" ? optimistic.filter((p) => computeStatus(p) === COTS_ORDERED && ofCategory(p)) : [];
  const sendToOrder = () => {
    const ids = allRows.filter((r) => selected.has(r.key)).flatMap((r) => r.members.map((m) => m.id));
    save(ids.map((id) => ({ id, changes: { status: COTS_ORDERED, cotsSentBack: null } })));
    setSelecting(null);
    setSelected(new Set());
  };
  const setStatusOfSelected = (status: string) => {
    const ids = allRows.filter((r) => selected.has(r.key)).flatMap((r) => r.members.map((m) => m.id));
    save(ids.map((id) => ({ id, changes: status === COTS_ORDERED ? { status, cotsSentBack: null } : { status } })));
    setSelecting(null);
    setSelected(new Set());
  };
  const toggleSelecting = (m: "order" | "status" | "cart") => {
    setSelecting((cur) => (cur === m ? null : m));
    setSelected(new Set());
    setCartTarget("");
  };
  const vendorCarts = cartVendor ? shownCarts.filter((c) => c.cart.vendor === cartVendor) : [];
  const targetCart = vendorCarts.find((c) => c.cart.id === cartTarget)?.cart ?? null;
  const submitCart = () => {
    const ids = allRows.filter((r) => selected.has(r.key)).flatMap((r) => r.members.map((m) => m.id));
    setError(null);
    startTransition(async () => {
      const r = await saveCotsCart(targetCart?.id ?? null, ids);
      if (r.error) setError(r.error);
      else toggleSelecting("cart");
    });
  };
  const cartLayout = view === "list" ? "list" : "cards";
  // A part inside an open cart: the Order List's own card, or its row in the List view.
  const cartMember = (p: CardPart) => {
    const row: Row = { key: p.id, part: p, members: [p] };
    return cartLayout === "list" ? (
      <PartListRow part={p} save={saveRow(row)} onOpen={openRow(row)} />
    ) : (
      <CotsCard part={p} save={saveRow(row)} onOpen={openRow(row)} showSystem variant="order" shelfOnThumb struck={struck.has(p.id)} />
    );
  };
  const removeFromCart = (cartId: string) => (ids: string[]) =>
    startTransition(async () => {
      const r = await removeFromCotsCart(cartId, ids);
      if (r.error) setError(r.error);
    });
  useEscape(ordering, () => {
    setSelecting(null);
    setSelected(new Set());
  });

  return (
    <div className={`space-y-5 ${ordering ? "pb-20" : ""}`}>
      <CategoryBoxes
        compact
        categories={categories}
        counts={counts}
        group={group}
        category={category}
        onGroup={(g) => pushQuery({ group: g, cat: null })}
        onCategory={(c) => pushQuery({ cat: c })}
      />

      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2.5">
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: "cards", label: "Cards" },
            { value: "list", label: "List" },
            { value: "table", label: "Table" },
          ]}
        />
        <button
          type="button"
          onClick={() => {
            setByVendor((v) => !v);
            setVendorPick(null);
          }}
          aria-pressed={byVendor}
          className={`press rounded-lg border px-2.5 py-1 text-xs font-semibold sm:px-3.5 sm:py-1.5 transition-colors active:scale-[0.98] ${
            byVendor ? "border-accent bg-accent text-white" : "border-line-strong bg-raised text-muted hover:text-fg"
          }`}
        >
          Vendors
        </button>
        {work && <button
          type="button"
          onClick={() => toggleSelecting("status")}
          aria-pressed={selecting === "status"}
          className={`press rounded-lg border px-2.5 py-1 text-xs font-semibold sm:px-3.5 sm:py-1.5 transition-colors active:scale-[0.98] ${
            selecting === "status" ? "border-accent bg-accent text-white" : "border-line-strong bg-raised text-muted hover:text-fg"
          }`}
        >
          Status
        </button>}
        {list === "order" &&
          ORDER_FILTERS.map((s) => {
            const color = getCotsStatus(s)?.color ?? "#94a3b8";
            const on = statusFilter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter((cur) => (cur === s ? null : s))}
                aria-pressed={on}
                style={{ borderColor: color, background: on ? `${color}40` : undefined }}
                className="press flex items-center gap-1.5 rounded-lg border-2 px-2.5 py-1 text-xs font-bold text-fg transition-colors active:scale-[0.98] sm:gap-2 sm:px-3.5 sm:py-1.5 sm:text-sm"
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                {s === COTS_ORDERED ? (
                  <>
                    <span className="sm:hidden">Order List</span>
                    <span className="hidden sm:inline">In Order List</span>
                  </>
                ) : (
                  s
                )}
                <span className="font-mono text-xs tabular-nums">{statusCounts.get(s) ?? 0}</span>
              </button>
            );
          })}
        {group && (
          <button type="button" onClick={() => pushQuery({ group: null, cat: null })} className="press rounded-full border border-line-strong px-3 py-1 text-xs font-medium text-fg-2 hover:text-fg">
            {categories.find((c) => c.id === category)?.label ?? groupLabel(group)} ✕
          </button>
        )}
        {list === "order" && work && (
          <button
            type="button"
            onClick={() => toggleSelecting("cart")}
            aria-pressed={selecting === "cart"}
            title="Pick parts from one vendor to buy together"
            className={`press ml-auto flex min-h-10 items-center gap-1.5 rounded-xl px-5 py-2 text-base font-bold shadow-lg transition-colors active:scale-[0.98] ${
              selecting === "cart" ? "border border-line-strong bg-surface text-fg" : "bg-amber-400 text-slate-950 shadow-amber-400/40 hover:bg-amber-300"
            }`}
          >
            {selecting === "cart" ? (
              "Cancel"
            ) : (
              <>
                <Icon name="cart" className="h-5 w-5" />
                Cart
              </>
            )}
          </button>
        )}
        {list === "released" && (
          // Phone: the add row (place + search) takes the full width and Send to order sits on its own
          // row under it, so they never overlap; from sm up they share one wrapping row, tops aligned
          // and all 48px tall, so "+ Add without searching" under the box doesn't push the others down.
          <div className="ml-auto flex w-full min-w-0 flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-end lg:w-auto lg:flex-nowrap">
            {edit && shelf && !ordering && (
              <div className="flex w-full min-w-0 items-start gap-2 sm:w-auto sm:flex-1 lg:flex-none">
                <select value={addTo} onChange={(e) => setAddTo(e.target.value)} className="input min-h-12 w-auto max-w-[40%] shrink-0 py-2 text-sm sm:max-w-none" aria-label="Add the card to">
                  {places.map((p) => (
                    <option key={p.robotId ?? ""} value={p.robotId ?? ""}>
                      Add to: {p.name}
                    </option>
                  ))}
                </select>
                <AddBoxSlot shelf={shelf} onPick={addItem} />
              </div>
            )}
            {work && canOrder && <button
              onClick={() => toggleSelecting("order")}
              aria-pressed={selecting === "order"}
              className={`press min-h-12 w-full shrink-0 rounded-xl px-7 py-2.5 text-lg font-bold sm:w-auto shadow-lg transition-colors active:scale-[0.98] ${
                selecting === "order" ? "border border-line-strong bg-surface text-fg" : "bg-amber-400 text-slate-950 shadow-amber-400/40 hover:bg-amber-300"
              }`}
            >
              {selecting === "order" ? "Cancel" : "🛒 Send to order"}
            </button>}
          </div>
        )}
      </div>

      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">Couldn&apos;t save: {error}</p>}
      {notice && !error && (
        <p className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <span className="flex-1">{notice}</span>
          <button type="button" className="press" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <Icon name="close" className="h-4 w-4" />
          </button>
        </p>
      )}

      {byVendor && vendors.length > 0 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible" role="group" aria-label="Vendors">
          {vendors.map((v) => {
            const on = vendorPick === v;
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                onClick={() => setVendorPick(on ? null : v)}
                className={`card-interactive group flex h-12 shrink-0 items-center gap-2.5 overflow-hidden pr-3 text-left active:scale-[0.98] ${on ? "border-accent ring-2 ring-accent" : ""}`}
              >
                <span className="flex h-full w-12 shrink-0 items-center justify-center bg-gradient-to-br from-sky-500/25 via-raised to-amber-400/20 text-sky-400">
                  <Icon name="cart" className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs leading-tight font-bold whitespace-nowrap text-fg">{v}</span>
                  <span className="font-mono text-[11px] text-subtle tabular-nums">{rowsOf(main.filter((p) => vendorOf(p) === v)).length}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {shownCarts.length > 0 && (
        <Section title="Carts" count={shownCarts.length}>
          <BomProvider value={{ inventory: [], isAdmin: false }}>
            <OpenBatchContext.Provider value={{ id: openCart, set: setOpenCart }}>
              {/* Like Factory Fab's packs: cards, or rows in the List view (Table shows cards). */}
              <div className={cartLayout === "list" ? "list-stack fab-grid" : "card-grid fab-grid"} style={{ "--card-min": "220px" } as React.CSSProperties}>
                {shownCarts.map(({ cart, members }) => (
                  <CartCard
                    key={cart.id}
                    cart={cart}
                    members={members}
                    layout={cartLayout}
                    save={(ids, changes) => save(ids.map((id) => ({ id, changes })))}
                    card={cartMember}
                    onRemove={removeFromCart(cart.id)}
                  />
                ))}
              </div>
            </OpenBatchContext.Provider>
          </BomProvider>
        </Section>
      )}

      {byVendor ? (
        vendors.length === 0 && arrived.length === 0 ? (
          <Empty list={list} />
        ) : (
          vendors.filter((v) => !vendorPick || !vendors.includes(vendorPick) || v === vendorPick).map((v) => {
            const ps = main.filter((p) => vendorOf(p) === v);
            return (
              <Section key={v} title={v} count={rowsOf(ps).length}>
                {byPlace(ps)}
              </Section>
            );
          })
        )
      ) : (
        <>
          {placeRows.map(({ place, rows }) =>
            place.robotId === null || rows.length ? (
              <BomProvider key={place.robotId ?? "general"} value={{ inventory: [], isAdmin: false, robotId: place.robotId ?? undefined }}>
                <Section title={place.robotId ? `In ${place.name}` : "General"} count={rows.length || undefined} onDropParts={draggable ? dropTo("list") : undefined}>
                  {rows.length ? renderRows(rows) : <p className="text-sm text-subtle">Parts that don&apos;t belong to a robot will show here.</p>}
                </Section>
              </BomProvider>
            ) : null,
          )}
          {allRows.length === 0 && arrived.length === 0 && <Empty list={list} />}
        </>
      )}

      {list === "released" && (
        <Section title="In order list" count={queued.length} small defaultOpen={false} onDropParts={draggable ? dropTo("ordered") : undefined}>
          {queued.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line py-6 text-center text-sm text-subtle">Drag parts here, or set a card&apos;s status to In Order List (phones can&apos;t drag).</p>
          ) : (
            byPlace(queued, { small: true, from: "ordered" })
          )}
        </Section>
      )}

      {arrived.length > 0 && (
        <div className="rounded-xl border border-teal-400/55 bg-teal-500/[0.03] p-3 shadow-[0_0_20px_-4px_rgba(20,184,166,0.32)] ring-1 ring-teal-400/30">
          <Section title="Arrived" count={rowsOf(arrived).length}>
            {byPlace(arrived)}
          </Section>
        </div>
      )}

      {inStock.length > 0 && (
        <Section title="In stock" count={inStock.length} small defaultOpen={false}>
          {byPlace(inStock, { small: true, clearable: true })}
        </Section>
      )}

      {selecting === "status" && (
        <div className="sticky bottom-3 z-30 rounded-xl border border-line-strong bg-surface/95 p-3 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono font-semibold tabular-nums">{selected.size} selected</span>
            <span className="text-subtle">Set to:</span>
            {bulkStatuses.map((s) => {
              const color = getCotsStatus(s)?.color ?? "#94a3b8";
              return (
                <button
                  key={s}
                  type="button"
                  disabled={pending || selected.size === 0}
                  onClick={() => setStatusOfSelected(s)}
                  style={{ borderColor: color }}
                  className="press flex items-center gap-1.5 rounded-lg border-2 px-3 py-1.5 text-xs font-bold text-fg transition-colors hover:bg-raised active:scale-[0.98] disabled:opacity-50"
                >
                  <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                  {s}
                </button>
              );
            })}
            <span className="ml-auto" />
            <button className="btn" onClick={() => setSelected(new Set(allRows.map((r) => r.key)))}>
              Select all
            </button>
            <button className="btn" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
              Clear
            </button>
            <button className="btn" onClick={() => toggleSelecting("status")}>
              Done
            </button>
          </div>
        </div>
      )}

      {selecting === "cart" && (
        <div className="sticky bottom-3 z-30 rounded-xl border border-line-strong bg-surface/95 p-3 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold tabular-nums">{selected.size} selected</span>
            <span className="text-subtle">{cartVendor ? `From ${cartVendor}: tap more of its parts.` : "Tap the parts to buy together, all from one vendor."}</span>
            <span className="ml-auto" />
            {vendorCarts.length > 0 && (
              <select className="input w-auto py-1" value={targetCart?.id ?? ""} onChange={(e) => setCartTarget(e.target.value)} aria-label="Cart to add to">
                <option value="">New cart</option>
                {vendorCarts.map(({ cart, members }) => (
                  <option key={cart.id} value={cart.id}>
                    {`${new Date(cart.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${members.length} part${members.length === 1 ? "" : "s"}`}
                  </option>
                ))}
              </select>
            )}
            <button className="btn-primary active:scale-[0.98]" disabled={pending || selected.size === 0} onClick={submitCart}>
              {targetCart ? "✓ Add to cart" : "✓ Create cart"}
            </button>
            <button className="btn active:scale-[0.98]" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
              Clear
            </button>
          </div>
        </div>
      )}

      {selecting === "order" && (
        <div className="sticky bottom-3 z-30 rounded-xl border border-line-strong bg-surface/95 p-3 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold tabular-nums">{selected.size} selected</span>
            <span className="text-subtle">Tap the parts to order.</span>
            <span className="ml-auto" />
            <button className="btn-primary" disabled={pending || selected.size === 0} onClick={sendToOrder}>
              ✓ Send to order list
            </button>
            <button className="btn" onClick={() => setSelected(new Set(allRows.map((r) => r.key)))}>
              Select all
            </button>
            <button className="btn" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Released's search box: the Inventory page's own, handing the picked or new item to the page.
function AddBoxSlot({ shelf, onPick }: { shelf: CotsShelf; onPick: (itemId: string) => void }) {
  const [q, setQ] = useState("");
  return (
    <div className="flex w-full min-w-0 flex-1 lg:w-[28rem] lg:flex-none">
      <AddBox q={q} setQ={setQ} {...shelf} defaultCategory={null} placeholder="Add a COTS part: type a name or paste a link" onPick={onPick} newStock="0" />
    </div>
  );
}

function Empty({ list }: { list: "released" | "order" }) {
  return (
    <p className="rounded-lg border border-dashed border-line py-8 text-center text-sm text-subtle">
      {list === "released" ? "No released COTS parts." : "Nothing on the order list."}
    </p>
  );
}

// The X on a card in an In stock section.
function ClearButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Clear from In stock"
      aria-label={`Clear ${name} from In stock`}
      className="press absolute -top-2 -right-2 z-30 flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-surface text-subtle shadow-md hover:text-fg active:scale-[0.98]"
    >
      <Icon name="close" className="h-3.5 w-3.5" />
    </button>
  );
}

function Section({
  title,
  count,
  small = false,
  defaultOpen = true,
  onDropParts,
  children,
}: {
  title: string;
  count?: number;
  small?: boolean;
  defaultOpen?: boolean;
  onDropParts?: (load: DragLoad) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
      const raw = e.dataTransfer.getData(DRAG_TYPE);
      if (raw) {
        e.preventDefault();
        onDropParts(JSON.parse(raw) as DragLoad);
      }
    },
  };
  return (
    <section {...dropProps} className={`-m-2 space-y-3 rounded-xl p-2 transition-colors ${over ? "bg-accent/5 ring-2 ring-accent/40" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="press flex w-full items-center gap-3 py-1 text-left">
        <Chevron open={open} small={small} />
        <h2 className={small ? "text-base font-semibold text-fg-2" : "display text-2xl font-bold"}>{title}</h2>
        {count !== undefined && <span className="rounded-full bg-raised px-2.5 py-0.5 font-mono text-sm font-bold text-fg-2 tabular-nums">{count}</span>}
        <div className={`flex-1 ${small ? "h-px bg-line" : "h-0.5 bg-line-strong"}`} />
      </button>
      {open && children}
    </section>
  );
}

// The same part from several systems, opened: a big card across the row with the part's name and
// total on top (click it to close) and each system's part inside, its system highlighted.
function GroupBox({ row, onClose, children, ...drag }: { row: Row; onClose: () => void; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const p = row.part;
  return (
    <div {...drag} style={{ gridColumn: "1 / -1", ...statusTint(computeStatus(p)) }} className="card-interactive flex flex-col ring-2 ring-amber-400/70 ring-offset-2 ring-offset-ink">
      <button type="button" onClick={onClose} aria-expanded className="press flex items-center gap-3 p-3 text-left">
        <span className="thumb-well thumb-cots flex h-14 w-20 shrink-0 items-center justify-center rounded-md">
          <Thumb part={p} size={52} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-fg">{partTitle(p)}</span>
          <span className="font-mono text-xs text-subtle tabular-nums">
            ×{p.quantity} in {new Set(row.members.map((m) => m.systemId)).size} systems
          </span>
        </span>
        <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-amber-950">Close ⧉</span>
      </button>
      <div className="card-grid cursor-default border-t border-line p-3" style={{ "--card-min": "240px" } as React.CSSProperties}>
        {children}
      </div>
    </div>
  );
}

// The table ("chart") view of the same cards.
function CotsTable({
  rows,
  saveRow,
  struck,
  orderList,
  onClear,
}: {
  rows: Row[];
  saveRow: (row: Row) => (changes: PartChanges) => void;
  struck: Set<string>;
  orderList: boolean;
  onClear?: (ids: string[]) => void;
}) {
  const currency = useCurrency();
  return (
    <SheetViewport id={orderList ? "cots-order" : "cots"}>
      <table className="data-table cots-table">
        <thead>
          <tr>
            <th />
            <th className="sheet-name">Part</th>
            <th>Systems</th>
            <th className="text-right">Qty</th>
            <th className="text-right">In stock</th>
            <th className="text-right">To order</th>
            <th className="text-right">Each</th>
            <th className="text-right">Total</th>
            <th>Where to buy</th>
            <th>Status</th>
            {onClear && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const p = row.part;
            const link = p.cotsLinks?.[0];
            const total = cotsTotal(p);
            const crossed = row.members.every((m) => struck.has(m.id));
            return (
              <tr key={row.key} className={crossed ? "opacity-60" : undefined} style={statusTint(computeStatus(p))}>
                <td>
                  <ThumbLocate part={p} />
                </td>
                <td className={`sheet-name font-semibold ${crossed ? "line-through" : ""} ${row.members.length > 1 ? "text-amber-500" : ""}`}>
                  {link ? (
                    <a href={link.url} target="_blank" rel="noreferrer" className="text-sky-500 underline-offset-2 hover:underline dark:text-sky-400">
                      {partTitle(p)}
                    </a>
                  ) : (
                    partTitle(p)
                  )}
                </td>
                <td className="text-muted">{p.systemName}</td>
                <td className="text-right font-mono tabular-nums">{p.quantity}</td>
                <td className="text-right font-mono tabular-nums" title={p.shelf && !p.shelf.sheet ? `Covered by ${p.shelf.itemName} on the shelf` : undefined}>
                  {p.shelf && !p.shelf.sheet ? p.shelf.covered : p.stockCount}
                </td>
                <td className="text-right font-mono tabular-nums">{Math.max(0, p.quantity - (p.shelf && !p.shelf.sheet ? p.shelf.covered : p.stockCount)) || "—"}</td>
                <td className="text-right font-mono text-emerald-500 tabular-nums">{p.unitPrice == null ? "—" : formatPrice(p.unitPrice, currency)}</td>
                <td className="text-right font-mono font-semibold text-emerald-500 tabular-nums">{total == null ? "—" : formatPrice(total, currency)}</td>
                <td className="text-xs">
                  {(p.cotsLinks ?? []).map((l, i) => (
                    <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {i > 0 && ", "}
                      {siteOf(l)}
                    </a>
                  ))}
                </td>
                <td>
                  {orderList ? <OrderStatusButton part={p} save={saveRow(row)} compact /> : <StatusField part={p} save={saveRow(row)} />}
                </td>
                {onClear && (
                  <td>
                    <button type="button" onClick={() => onClear(row.members.map((m) => m.id))} className="press rounded p-1 text-subtle hover:text-fg" aria-label={`Clear ${partTitle(p)} from In stock`}>
                      <Icon name="close" className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </SheetViewport>
  );
}

// A table row's thumbnail: a click opens the part's place in the robot.
function ThumbLocate({ part }: { part: CardPart }) {
  const { robotId } = useBom();
  const [stage, setStage] = useState<StageView | null>(null);
  return (
    <>
      <button type="button" onClick={() => setStage(robotId ? "locate" : "part")} className="press block cursor-zoom-in" aria-label={`Locate ${partTitle(part)} in the robot`}>
        <Thumb part={part} size={44} />
      </button>
      {stage && (
        <PartStage
          partId={ownerPartId(part)}
          robotId={robotId ?? null}
          modelKey={part.modelKey}
          name={partTitle(part)}
          view={stage}
          onView={setStage}
          onClose={() => setStage(null)}
        />
      )}
    </>
  );
}
