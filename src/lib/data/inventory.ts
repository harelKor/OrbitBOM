import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { cotsStatusOf } from "@/config/cots";
import { isSheetType } from "@/config/partTypes";
import { groupPath } from "@/lib/inventory/groups";
import type { Shelf, ShelfSuggestion } from "@/components/bom/types";
import { suggestItem } from "@/lib/inventory/match";
import { computeUsage, type ItemUsage, type UsagePart } from "@/lib/inventory/usage";

const { inventoryItems, inventoryGroups, inventoryConditions, inventoryLocations, parts, systems, robots } = schema;

export type InventoryItem = typeof inventoryItems.$inferSelect & { usage: ItemUsage | null; sheet: boolean };
export type InventoryGroup = typeof inventoryGroups.$inferSelect;
export type InventoryCondition = typeof inventoryConditions.$inferSelect;
export type InventoryLocation = typeof inventoryLocations.$inferSelect;

type Exec = Pick<typeof db, "select">;

// Live BOM parts that draw on an inventory item, in active robots only.
async function usageParts(exec: Exec = db, filter: { robotId?: string; itemIds?: string[] } = {}): Promise<UsagePart[]> {
  if (filter.itemIds && !filter.itemIds.length) return [];
  const rows = await exec
    .select({
      partId: parts.id,
      inventoryItemId: parts.inventoryItemId,
      quantity: parts.quantity,
      classification: parts.classification,
      designState: parts.designState,
      robotId: robots.id,
      robotName: robots.name,
      systemName: systems.name,
      displayName: parts.displayName,
      onshapeName: parts.onshapeName,
    })
    .from(parts)
    .innerJoin(systems, eq(systems.id, parts.systemId))
    .innerJoin(robots, eq(robots.id, systems.robotId))
    .where(
      and(
        isNotNull(parts.inventoryItemId),
        isNull(parts.removedFromCadAt),
        eq(robots.archived, false),
        filter.robotId ? eq(robots.id, filter.robotId) : undefined,
        filter.itemIds ? inArray(parts.inventoryItemId, filter.itemIds) : undefined,
      ),
    )
    .orderBy(desc(robots.year), asc(robots.name), asc(systems.name), asc(parts.displayName), asc(parts.id));
  return rows.map((r) => ({
    partId: r.partId,
    inventoryItemId: r.inventoryItemId!,
    quantity: r.quantity,
    robotId: r.robotId,
    robotName: r.robotName,
    systemName: r.systemName,
    partName: r.displayName ?? r.onshapeName ?? "Unnamed part",
    status: r.classification === "cots" ? cotsStatusOf(r.designState) : undefined,
  }));
}

const sheetSet = (items: { id: string; templateId: string | null }[]) => new Set(items.filter((i) => isSheetType(i.templateId)).map((i) => i.id));

// Usage of some items across every active robot (the shared shelf).
export async function usageOf(itemIds: string[], exec: Exec = db) {
  if (!itemIds.length) return { items: [], usage: new Map<string, ItemUsage>() };
  const [items, used] = await Promise.all([
    exec.select().from(inventoryItems).where(inArray(inventoryItems.id, itemIds)),
    usageParts(exec, { itemIds }),
  ]);
  return { items, usage: computeUsage(new Map(items.map((i) => [i.id, i.inStock])), used, sheetSet(items)) };
}

export async function listInventory() {
  const [items, groups, conditions, locations, used] = await Promise.all([
    db.select().from(inventoryItems).orderBy(asc(inventoryItems.name)),
    db.select().from(inventoryGroups).orderBy(asc(inventoryGroups.name)),
    db.select().from(inventoryConditions).orderBy(asc(inventoryConditions.label)),
    db.select().from(inventoryLocations).orderBy(asc(inventoryLocations.name)),
    usageParts(),
  ]);
  const sheets = sheetSet(items);
  const usage = computeUsage(new Map(items.map((i) => [i.id, i.inStock])), used, sheets);
  return {
    items: items.map((i) => ({ ...i, usage: usage.get(i.id) ?? null, sheet: sheets.has(i.id) })) as InventoryItem[],
    groups,
    conditions,
    locations,
  };
}

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

// A robot's inventory page and dashboard card: what its parts draw from the shared shelf.
export async function robotInventory(robotId: string): Promise<RobotShelfItem[]> {
  const mine = await usageParts(db, { robotId });
  if (!mine.length) return [];
  const itemIds = [...new Set(mine.map((p) => p.inventoryItemId))];
  const [{ items, usage }, groups] = await Promise.all([usageOf(itemIds), db.select().from(inventoryGroups)]);
  return items
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => {
      const u = usage.get(i.id)!;
      const robot = u.robots.find((r) => r.robotId === robotId);
      return {
        id: i.id,
        name: i.name,
        group: groupPath(groups, i.groupId),
        sheet: isSheetType(i.templateId),
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
  return db
    .select({ id: inventoryItems.id, name: inventoryItems.name })
    .from(inventoryItems)
    .orderBy(asc(inventoryItems.name));
}

// What a part card shows about the shelf: its item's stock and how much of the part it covers,
// or, for a COTS part with no item, the item it most likely is.

type ShelfPart = typeof parts.$inferSelect;

export async function shelfOfParts(rows: ShelfPart[]) {
  const shelf = new Map<string, Shelf>();
  const suggestion = new Map<string, ShelfSuggestion>();
  const linked = rows.filter((p) => p.inventoryItemId);
  const unlinked = rows.filter((p) => !p.inventoryItemId && p.classification === "cots");
  if (!linked.length && !unlinked.length) return { shelf, suggestion };
  const [{ items, usage }, all] = await Promise.all([
    usageOf([...new Set(linked.map((p) => p.inventoryItemId!))]),
    unlinked.length
      ? db
          .select({ id: inventoryItems.id, name: inventoryItems.name, onshapeKey: inventoryItems.onshapeKey, aliases: inventoryItems.aliases, vendorUrl: inventoryItems.vendorUrl, inStock: inventoryItems.inStock, templateId: inventoryItems.templateId })
          .from(inventoryItems)
      : [],
  ]);
  for (const p of linked) {
    const item = items.find((i) => i.id === p.inventoryItemId);
    if (!item) continue;
    const u = usage.get(item.id);
    shelf.set(p.id, {
      itemId: item.id,
      itemName: item.name,
      sheet: isSheetType(item.templateId),
      inStock: item.inStock,
      need: u?.need ?? 0,
      // A part on an archived robot isn't in the usage; it shows the stock but covers nothing.
      covered: u?.coveredOf.get(p.id) ?? 0,
      free: u ? u.free : item.inStock,
    });
  }
  for (const p of unlinked) {
    const hit = suggestItem(p, all);
    const item = hit && all.find((i) => i.id === hit.itemId);
    if (item) suggestion.set(p.id, { itemId: item.id, itemName: item.name, inStock: item.inStock, sheet: isSheetType(item.templateId), reason: hit.reason });
  }
  return { shelf, suggestion };
}

