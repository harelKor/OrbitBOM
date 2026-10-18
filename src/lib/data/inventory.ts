import "server-only";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { groupPath } from "@/lib/inventory/groups";
import { computeUsage, type ItemUsage, type UsagePart } from "@/lib/inventory/usage";

const { inventoryItems, inventoryGroups, inventoryConditions, inventoryLocations, parts, systems, robots } = schema;

export type InventoryItem = typeof inventoryItems.$inferSelect & { usage: ItemUsage | null };
export type InventoryGroup = typeof inventoryGroups.$inferSelect;
export type InventoryCondition = typeof inventoryConditions.$inferSelect;
export type InventoryLocation = typeof inventoryLocations.$inferSelect;

// Live BOM parts that draw on an inventory item, in active robots only.
async function usageParts(robotId?: string): Promise<UsagePart[]> {
  const rows = await db
    .select({
      partId: parts.id,
      inventoryItemId: parts.inventoryItemId,
      quantity: parts.quantity,
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
        robotId ? eq(robots.id, robotId) : undefined,
      ),
    )
    .orderBy(asc(systems.name), asc(parts.displayName));
  return rows.map((r) => ({
    partId: r.partId,
    inventoryItemId: r.inventoryItemId!,
    quantity: r.quantity,
    robotId: r.robotId,
    robotName: r.robotName,
    systemName: r.systemName,
    partName: r.displayName ?? r.onshapeName ?? "Unnamed part",
  }));
}

export async function listInventory() {
  const [items, groups, conditions, locations, used] = await Promise.all([
    db.select().from(inventoryItems).orderBy(asc(inventoryItems.name)),
    db.select().from(inventoryGroups).orderBy(asc(inventoryGroups.name)),
    db.select().from(inventoryConditions).orderBy(asc(inventoryConditions.label)),
    db.select().from(inventoryLocations).orderBy(asc(inventoryLocations.name)),
    usageParts(),
  ]);
  const usage = computeUsage(new Map(items.map((i) => [i.id, i.inStock])), used);
  return {
    items: items.map((i) => ({ ...i, usage: usage.get(i.id) ?? null })) as InventoryItem[],
    groups,
    conditions,
    locations,
  };
}

// The robot page's "Inventory on this robot" panel.
export async function robotInventory(robotId: string) {
  const used = await usageParts(robotId);
  if (!used.length) return [];
  const [items, groups] = await Promise.all([
    db.select().from(inventoryItems).orderBy(asc(inventoryItems.name)),
    db.select().from(inventoryGroups),
  ]);
  const usage = computeUsage(new Map(items.map((i) => [i.id, i.inStock])), used);
  return items
    .filter((i) => usage.has(i.id))
    .map((i) => {
      const u = usage.get(i.id)!;
      return {
        id: i.id,
        name: i.name,
        group: groupPath(groups, i.groupId),
        inStock: i.inStock,
        needed: u.robots[0].needed,
        parts: u.parts,
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
