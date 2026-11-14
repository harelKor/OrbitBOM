import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { cotsStatusOf } from "@/config/cots";
import { NOT_LAID_OUT } from "@/config/rawStock";
import { categoryOf, getCategory, type InvCategory } from "@/lib/inventory/categories";
import { cachedQuery } from "./cache";
import { categoryImageUrl, listCategories } from "./categories";
import { listPlaces } from "./places";
import type { Shelf, ShelfSuggestion } from "@/components/bom/types";
import { itemMatcher, suggestItem } from "@/lib/inventory/match";
import { computeUsage, type ItemUsage, type UsagePart } from "@/lib/inventory/usage";
import { newestOpenOrders, type OpenOrder } from "@/lib/inventory/season";
import { thumbKey } from "@/lib/onshape/thumbnails";
import { imageUrl } from "@/lib/storage/r2";

const { inventoryItems, inventoryLinkRejections, partReviews, inventoryGroups, inventoryConditions, inventoryMoves, inventoryItemHistory, members, parts, systems, robots } = schema;

// `category` is resolved (set, or guessed from the name); `thumbUrl` is the item's own photo
// (a product's picture saved to R2), else the Onshape thumbnail of a part linked to it.
export type InventoryItem = Omit<typeof inventoryItems.$inferSelect, "category"> & {
  category: string;
  categorySet: string | null; // the category someone picked, if any
  usage: ItemUsage | null;
  openOrder: OpenOrder | null; // the newest COTS card on its way for it
  sheet: boolean;
  thumbUrl: string | null;
};
export type InventoryGroup = typeof inventoryGroups.$inferSelect;
export type InventoryCondition = typeof inventoryConditions.$inferSelect;
export type InventoryLocation = typeof schema.inventoryLocations.$inferSelect;

type Exec = Pick<typeof db, "select">;

// Live BOM parts that draw on an inventory item, in active robots only.
async function usageParts(exec: Exec = db, filter: { robotId?: string; itemIds?: string[] } = {}): Promise<UsagePart[]> {
  if (filter.itemIds && !filter.itemIds.length) return [];
  const query = exec
    .select({
      partId: parts.id,
      inventoryItemId: parts.inventoryItemId,
      quantity: parts.quantity,
      classification: parts.classification,
      designState: parts.designState,
      robotId: robots.id,
      robotName: robots.name,
      systemId: systems.id,
      systemName: systems.name,
      displayName: parts.displayName,
      onshapeName: parts.onshapeName,
    })
    .from(parts)
    // A COTS card added on the COTS page may have no system (its robot is on the part), or no
    // robot either (the General section).
    .leftJoin(systems, eq(systems.id, parts.systemId))
    .leftJoin(robots, eq(robots.id, sql`coalesce(${systems.robotId}, ${parts.robotId})`))
    .where(
      and(
        isNotNull(parts.inventoryItemId),
        isNull(parts.removedFromCadAt),
        // A card Inventory sent to refill the shelf orders stock; no robot uses it.
        eq(parts.restock, false),
        or(isNull(robots.id), eq(robots.archived, false)),
        filter.robotId ? eq(robots.id, filter.robotId) : undefined,
        filter.itemIds ? inArray(parts.inventoryItemId, filter.itemIds) : undefined,
      ),
    )
    .orderBy(desc(robots.year), asc(robots.name), asc(systems.name), asc(parts.displayName), asc(parts.id));
  // A transaction reads its own; everyone else shares the copy kept until these tables change.
  const rows = exec === db ? await cachedQuery(query, ["parts", "systems", "robots"]) : await query;
  return rows.map((r) => ({
    partId: r.partId,
    inventoryItemId: r.inventoryItemId!,
    quantity: r.quantity,
    robotId: r.robotId ?? "",
    robotName: r.robotName ?? "General",
    systemId: r.systemId ?? undefined,
    systemName: r.systemName ?? "",
    partName: r.displayName ?? r.onshapeName ?? "Unnamed part",
    status: r.classification === "cots" ? cotsStatusOf(r.designState) : undefined,
  }));
}

type Named = { id: string; category: string | null; name: string };
const isSheet = (i: Omit<Named, "id">, cats: InvCategory[]) => !!getCategory(cats, categoryOf(i, cats))?.sheet;
const sheetSet = (items: Named[], cats: InvCategory[]) => new Set(items.filter((i) => isSheet(i, cats)).map((i) => i.id));

// Usage of some items across every active robot (the shared shelf).
export async function usageOf(itemIds: string[], exec: Exec = db) {
  if (!itemIds.length) return { items: [], cats: await listCategories(), usage: new Map<string, ItemUsage>() };
  const [items, used, cats] = await Promise.all([
    exec.select().from(inventoryItems).where(inArray(inventoryItems.id, itemIds)),
    usageParts(exec, { itemIds }),
    listCategories(),
  ]);
  return { items, cats, usage: computeUsage(new Map(items.map((i) => [i.id, i.inStock])), used, sheetSet(items, cats)) };
}

// The shelf, or with `itemIds` only those items (an item's page or window reads just its own
// usage, order and picture, not the whole shop's).
export async function listInventory({ itemIds }: { itemIds?: string[] } = {}) {
  const [items, groups, conditions, locations, used, categories, orders] = await Promise.all([
    cachedQuery(
      db
        .select()
        .from(inventoryItems)
        .where(itemIds ? inArray(inventoryItems.id, itemIds) : undefined)
        .orderBy(asc(inventoryItems.name)),
      ["inventory_items"],
    ),
    cachedQuery(db.select().from(inventoryGroups).orderBy(asc(inventoryGroups.name)), ["inventory_groups"]),
    cachedQuery(db.select().from(inventoryConditions).orderBy(asc(inventoryConditions.label)), ["inventory_conditions"]),
    listPlaces(),
    usageParts(db, { itemIds }),
    listCategories(),
    openOrders(itemIds),
  ]);
  const sheets = sheetSet(items, categories);
  const usage = computeUsage(new Map(items.map((i) => [i.id, i.inStock])), used, sheets);
  const [thumbs, catUrls] = await Promise.all([itemThumbs(items, categories), Promise.all(categories.map((c) => categoryImageUrl(c.image)))]);
  categories.forEach((c, i) => (c.imageUrl = catUrls[i]));
  return {
    items: items.map((i) => ({
      ...i,
      category: categoryOf(i, categories),
      categorySet: i.category,
      usage: usage.get(i.id) ?? null,
      openOrder: orders.get(i.id) ?? null,
      sheet: sheets.has(i.id),
      thumbUrl: thumbs.get(i.id) ?? null,
    })) as InventoryItem[],
    groups,
    conditions,
    locations,
    categories,
  };
}

// Columns only the server reads (matching, the picture's R2 key, when it was made). Pages send
// the whole shelf, so they leave these out: about 15% of an Inventory page.
const SERVER_ONLY = ["onshapeKey", "aliases", "createdAt", "imagePath"] as const;
export type PageItem = Omit<InventoryItem, (typeof SERVER_ONLY)[number]>;
export function forPage(item: InventoryItem): PageItem {
  const out: Partial<InventoryItem> = { ...item };
  for (const k of SERVER_ONLY) delete out[k];
  return out as PageItem;
}
export function shelfForPage<T extends { items: InventoryItem[] }>(inventory: T): Omit<T, "items"> & { items: PageItem[] } {
  return { ...inventory, items: inventory.items.map(forPage) };
}

// Every item as the drawing editor's Fit picker shows it: name, category and picture only.
export async function listFitTargets() {
  const [items, categories] = await Promise.all([
    cachedQuery(db.select({ id: inventoryItems.id, name: inventoryItems.name, category: inventoryItems.category, imagePath: inventoryItems.imagePath }).from(inventoryItems).orderBy(asc(inventoryItems.name)), ["inventory_items"]),
    listCategories(),
  ]);
  const thumbs = await itemThumbs(items, categories);
  return items.map((i) => ({ id: i.id, name: i.name, category: categoryOf(i, categories), thumbUrl: thumbs.get(i.id) ?? null }));
}

// Each item's newest COTS card on its way (lib/inventory/season.ts says which count).
async function openOrders(itemIds?: string[]) {
  const rows = await cachedQuery(
    db
      .select({ itemId: parts.inventoryItemId, partId: parts.id, designState: parts.designState, systemId: parts.systemId, restock: parts.restock, at: parts.createdAt })
      .from(parts)
      .where(
        and(
          isNotNull(parts.inventoryItemId),
          isNull(parts.removedFromCadAt),
          eq(parts.classification, "cots"),
          itemIds ? inArray(parts.inventoryItemId, itemIds) : undefined,
        ),
      ),
    ["parts"],
  );
  return newestOpenOrders(rows.map((r) => ({ ...r, itemId: r.itemId!, status: cotsStatusOf(r.designState) })));
}

// One picture per item: its own photo, else the newest Onshape thumbnail among the parts linked
// to it. Raw Stock (a plate, tube, shaft, filament) keeps its own photo or its category's
// picture: a part cut from it isn't what it looks like, so a part thumbnail never stands in,
// and a part thumbnail saved as its photo by mistake is ignored (Harel, 2026-10-31).
const PART_THUMB = /^(thumbs|thumbnails)\//;
const isRawStock = (i: Omit<Named, "id">, cats: InvCategory[]) => {
  const cat = getCategory(cats, categoryOf(i, cats));
  return !!cat && (cat.group === "consumables" || cat.sheet);
};
export async function itemThumbs(items: (Named & { imagePath: string | null })[], cats: InvCategory[]) {
  const raw = new Set(items.filter((i) => isRawStock(i, cats)).map((i) => i.id));
  const photo = (i: { id: string; imagePath: string | null }) => (i.imagePath && !(raw.has(i.id) && PART_THUMB.test(i.imagePath)) ? i.imagePath : null);
  const own = await Promise.all(items.filter((i) => photo(i)).map(async (i) => [i.id, await imageUrl(photo(i)!)] as const));
  const itemIds = items.filter((i) => !photo(i) && !raw.has(i.id)).map((i) => i.id);
  if (!itemIds.length) return new Map(own.filter((u): u is readonly [string, string] => !!u[1]));
  // The parts' rows are kept until a part changes; the links are signed fresh (never cached).
  const rows = await cachedQuery(
    db
      .selectDistinctOn([parts.inventoryItemId], { itemId: parts.inventoryItemId, partId: parts.id, rev: parts.thumbnailRev })
      .from(parts)
      .where(and(inArray(parts.inventoryItemId, itemIds), isNotNull(parts.thumbnailRev)))
      .orderBy(parts.inventoryItemId, desc(parts.lastModifiedAt)),
    ["parts"],
  );
  const urls = await Promise.all(rows.map(async (r) => [r.itemId!, await imageUrl(thumbKey(r.partId, r.rev!))] as const));
  return new Map([...own, ...urls].filter((u): u is readonly [string, string] => !!u[1]));
}

// The item page: the item, every part on it, unlinked COTS parts that look like it, and its
// latest stock changes.
export async function inventoryItemDetail(itemId: string) {
  const base = await inventoryItemWithLists(itemId);
  if (!base) return null;
  const { item } = base;
  const [candidates, { moves, history }] = await Promise.all([
    db
      .select({
        part: {
          id: parts.id,
          displayName: parts.displayName,
          onshapeName: parts.onshapeName,
          quantity: parts.quantity,
          sourceDid: parts.sourceDid,
          sourceEid: parts.sourceEid,
          onshapePartId: parts.onshapePartId,
          cotsLinks: parts.cotsLinks,
        },
        systemName: systems.name,
        robotId: robots.id,
        robotName: robots.name,
      })
      .from(parts)
      .innerJoin(systems, eq(systems.id, parts.systemId))
      .innerJoin(robots, eq(robots.id, systems.robotId))
      .where(and(isNull(parts.inventoryItemId), isNull(parts.removedFromCadAt), eq(parts.classification, "cots"), eq(robots.archived, false))),
    itemHistory(itemId, item.inStock),
  ]);
  const matches = candidates.flatMap((c) => {
    const hit = suggestItem(c.part, [item]);
    return hit
      ? [{ partId: c.part.id, name: c.part.displayName ?? c.part.onshapeName ?? "Unnamed part", quantity: c.part.quantity, robotName: c.robotName, systemName: c.systemName, reason: hit.reason }]
      : [];
  });
  return { ...base, matches, moves, history };
}

// One item as the shelf list has it, with the lists its pills need (the item window).
export async function inventoryItemWithLists(itemId: string) {
  const { items, conditions, locations, groups, categories } = await listInventory({ itemIds: [itemId] });
  const item = items.find((i) => i.id === itemId);
  return item ? { item, conditions, locations, groups, categories } : null;
}

// An item's last 30 stock moves and 30 edits, newest first. `inStock` is today's count (read
// here when left out), from which each move's count after it is worked out.
export async function itemHistory(itemId: string, inStock?: number) {
  const [moves, edits, [current]] = await Promise.all([
    db
      .select({ id: inventoryMoves.id, delta: inventoryMoves.delta, reason: inventoryMoves.reason, at: inventoryMoves.at, via: inventoryMoves.via, memberName: members.name, aiName: inventoryMoves.aiName, partName: parts.displayName, onshapeName: parts.onshapeName })
      .from(inventoryMoves)
      .leftJoin(members, eq(members.id, inventoryMoves.memberId))
      .leftJoin(parts, eq(parts.id, inventoryMoves.partId))
      .where(eq(inventoryMoves.itemId, itemId))
      .orderBy(desc(inventoryMoves.at))
      .limit(30),
    db
      .select({ id: inventoryItemHistory.id, field: inventoryItemHistory.field, oldValue: inventoryItemHistory.oldValue, newValue: inventoryItemHistory.newValue, at: inventoryItemHistory.at, memberName: members.name, aiName: inventoryItemHistory.aiName })
      .from(inventoryItemHistory)
      .leftJoin(members, eq(members.id, inventoryItemHistory.memberId))
      .where(eq(inventoryItemHistory.itemId, itemId))
      .orderBy(desc(inventoryItemHistory.at))
      .limit(30),
    inStock === undefined ? db.select({ inStock: inventoryItems.inStock }).from(inventoryItems).where(eq(inventoryItems.id, itemId)) : [{ inStock }],
  ]);
  // Each move's count after it: today's stock less every newer move.
  let after = current?.inStock ?? 0;
  const stock = moves.map((m) => {
    const row = { ...m, partName: m.partName ?? m.onshapeName, after };
    after -= m.delta;
    return row;
  });
  const history: ItemHistoryEntry[] = [
    ...stock.map((m) => ({ kind: "move" as const, id: m.id, at: m.at, who: m.aiName ?? m.memberName, reason: m.reason, delta: m.delta, after: m.after, partName: m.partName })),
    ...edits.map((e) => ({ kind: "edit" as const, id: e.id, at: e.at, who: e.aiName ?? e.memberName, field: e.field, from: e.oldValue, to: e.newValue })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  return { moves: stock, history };
}

export type ItemHistoryEntry =
  | { kind: "move"; id: string; at: Date; who: string | null; reason: string; delta: number; after: number; partName: string | null }
  | { kind: "edit"; id: string; at: Date; who: string | null; field: string; from: unknown; to: unknown };

export type RobotShelfItem = {
  id: string;
  name: string;
  group: string;
  sheet: boolean;
  inStock: number;
  needed: number; // this robot
  covered: number; // this robot
  needAll: number; // every active robot
  parts: (UsagePart & { covered: number })[];
};

// A robot's inventory page and dashboard card: what its parts draw from the shared shelf. Raw
// Stock that's laid out on pieces (plates, tubes, shafts) shows in the Raw stock planner instead
// (Harel, 2026-11-07).
export async function robotInventory(robotId: string): Promise<RobotShelfItem[]> {
  const mine = await usageParts(db, { robotId });
  if (!mine.length) return [];
  const itemIds = [...new Set(mine.map((p) => p.inventoryItemId))];
  const { items, usage, cats } = await usageOf(itemIds);
  return items
    .filter((i) => {
      const cat = getCategory(cats, categoryOf(i, cats));
      return cat?.group !== "consumables" || NOT_LAID_OUT.includes(cat.id);
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => {
      const u = usage.get(i.id)!;
      const robot = u.robots.find((r) => r.robotId === robotId);
      return {
        id: i.id,
        name: i.name,
        group: getCategory(cats, categoryOf(i, cats))?.label ?? "",
        sheet: isSheet(i, cats),
        inStock: i.inStock,
        needed: robot?.needed ?? 0,
        covered: robot?.allocated ?? 0,
        needAll: u.need,
        parts: u.parts.filter((p) => p.robotId === robotId).map((p) => ({ ...p, covered: u.coveredOf.get(p.partId) ?? 0 })),
      };
    });
}

// Items for the BOM's INVENTORY material group and the "To BOM" target pickers.
export async function listInventoryNames() {
  return cachedQuery(db.select({ id: inventoryItems.id, name: inventoryItems.name }).from(inventoryItems).orderBy(asc(inventoryItems.name)), ["inventory_items"]);
}

// What a part card shows about the shelf: its item's stock and how much of the part it covers,
// or, for a part with no item, the item it most likely is: a link waiting in To Review first,
// else (COTS parts) a match by name, Onshape part or product page that nobody rejected.

type ShelfPart = typeof parts.$inferSelect;

export async function shelfOfParts(rows: ShelfPart[]) {
  const shelf = new Map<string, Shelf>();
  const suggestion = new Map<string, ShelfSuggestion>();
  const linked = rows.filter((p) => p.inventoryItemId);
  const open = rows.filter((p) => !p.inventoryItemId);
  const unlinked = open.filter((p) => p.classification === "cots");
  if (!linked.length && !open.length) return { shelf, suggestion };
  const itemCols = { id: inventoryItems.id, name: inventoryItems.name, onshapeKey: inventoryItems.onshapeKey, aliases: inventoryItems.aliases, cotsLinks: inventoryItems.cotsLinks, inStock: inventoryItems.inStock, category: inventoryItems.category };
  const [{ items, usage, cats }, all, waiting, rejected] = await Promise.all([
    usageOf([...new Set(linked.map((p) => p.inventoryItemId!))]),
    unlinked.length ? cachedQuery(db.select(itemCols).from(inventoryItems), ["inventory_items"]) : [],
    open.length
      ? db
          .select({ partId: partReviews.partId, itemId: sql<string>`${partReviews.pending}->>'inventoryItemId'` })
          .from(partReviews)
          .where(and(inArray(partReviews.partId, open.map((p) => p.id)), sql`${partReviews.pending} ? 'inventoryItemId'`))
      : [],
    unlinked.length
      ? db.select({ partId: inventoryLinkRejections.partId, itemId: inventoryLinkRejections.itemId }).from(inventoryLinkRejections).where(inArray(inventoryLinkRejections.partId, unlinked.map((p) => p.id)))
      : [],
  ]);
  // A waiting link's item, when the parts had no COTS part to load every item for.
  const allById = new Map(all.map((i) => [i.id, i]));
  const missing = [...new Set(waiting.map((w) => w.itemId))].filter((id) => !allById.has(id));
  const known = missing.length ? new Map([...allById, ...(await db.select(itemCols).from(inventoryItems).where(inArray(inventoryItems.id, missing))).map((i) => [i.id, i] as const)]) : allById;
  const thumbs = await itemThumbs(items, cats);
  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const p of linked) {
    const item = itemById.get(p.inventoryItemId!);
    if (!item) continue;
    const u = usage.get(item.id);
    const total = Math.max(u?.need ?? 0, item.seasonNeed ?? 0);
    shelf.set(p.id, {
      itemId: item.id,
      itemName: item.name,
      sheet: isSheet(item, cats),
      inStock: item.inStock,
      need: u?.need ?? 0,
      // A part on an archived robot isn't in the usage; it shows the stock but covers nothing.
      covered: u?.coveredOf.get(p.id) ?? 0,
      free: u ? u.free : item.inStock,
      total,
      restock: p.restock,
      met: total > 0 && item.inStock + 1e-9 >= total,
      thumbUrl: thumbs.get(item.id) ?? null,
    });
  }
  for (const w of waiting) {
    const item = known.get(w.itemId);
    if (item) suggestion.set(w.partId, { itemId: item.id, itemName: item.name, inStock: item.inStock, sheet: isSheet(item, cats), reason: "review", pending: true });
  }
  const no = new Set(rejected.map((r) => `${r.partId}:${r.itemId}`));
  const match = itemMatcher(all);
  for (const p of unlinked) {
    if (suggestion.has(p.id)) continue;
    const hit = match(p);
    const item = hit && !no.has(`${p.id}:${hit.itemId}`) && allById.get(hit.itemId);
    if (item) suggestion.set(p.id, { itemId: item.id, itemName: item.name, inStock: item.inStock, sheet: isSheet(item, cats), reason: hit.reason });
  }
  return { shelf, suggestion };
}


// ---------- COTS Order History (Harel, 2026-11-02; rows from lib/parts/orderHistory.ts) ----------

export type OrderHistoryCard = Omit<typeof schema.cotsOrderHistory.$inferSelect, "dismissedAt"> & { thumbUrl: string | null };

// The order's date for sorting: when it went In Route, else when it arrived, else when it was recorded.
const orderDate = (r: { inRouteAt: Date | null; arrivedAt: Date | null; createdAt: Date }) => (r.inRouteAt ?? r.arrivedAt ?? r.createdAt).getTime();

async function orderHistoryRows(itemId?: string): Promise<OrderHistoryCard[]> {
  const h = schema.cotsOrderHistory;
  const rows = await db
    .select({ card: h, item: { id: inventoryItems.id, name: inventoryItems.name, category: inventoryItems.category, imagePath: inventoryItems.imagePath } })
    .from(h)
    .leftJoin(inventoryItems, eq(inventoryItems.id, h.inventoryItemId))
    .where(and(isNull(h.dismissedAt), itemId ? eq(h.inventoryItemId, itemId) : undefined));
  const items = [...new Map(rows.filter((r) => r.item).map((r) => [r.item!.id, r.item!])).values()];
  const thumbs = items.length ? await itemThumbs(items, await listCategories()) : new Map<string, string>();
  return rows
    .map(({ card }) => {
      const { dismissedAt, ...rest } = card;
      void dismissedAt;
      return { ...rest, thumbUrl: (card.inventoryItemId && thumbs.get(card.inventoryItemId)) || null };
    })
    .sort((a, b) => orderDate(b) - orderDate(a));
}

// The Order History page: every card not dismissed, newest order first (the page groups by vendor).
export const listOrderHistory = () => orderHistoryRows();

// How many cards the COTS page's Order History box counts.
export async function countOrderHistory() {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.cotsOrderHistory).where(isNull(schema.cotsOrderHistory.dismissedAt));
  return row?.n ?? 0;
}

// An item's Past orders, newest first.
export const itemOrderHistory = (itemId: string) => orderHistoryRows(itemId);
