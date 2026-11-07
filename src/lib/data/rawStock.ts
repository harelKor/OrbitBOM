import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { groupRawStock, type RawGroup } from "@/lib/fab/rawStock";
import { listCategories } from "./categories";

const { parts, systems, robots, inventoryItems } = schema;

// The robot's Raw stock planner: its parts grouped by the stock they're cut from. One read of the
// parts and their items; the layouts are worked out in the browser.
export async function robotRawStock(robotId: string): Promise<RawGroup[]> {
  const [rows, cats, [robot]] = await Promise.all([
    db
      .select({
        id: parts.id,
        displayName: parts.displayName,
        onshapeName: parts.onshapeName,
        systemName: systems.name,
        material: parts.material,
        inventoryItemId: parts.inventoryItemId,
        geometry: parts.geometry,
        classification: parts.classification,
        quantity: parts.quantity,
        designState: parts.designState,
        preProcess: parts.preProcess,
        process1: parts.process1,
        process2: parts.process2,
        donePreprocess: parts.donePreprocess,
        doneProcess1: parts.doneProcess1,
        doneProcess2: parts.doneProcess2,
      })
      .from(parts)
      .innerJoin(systems, eq(systems.id, parts.systemId))
      .where(and(eq(systems.robotId, robotId), isNull(parts.removedFromCadAt)))
      .orderBy(asc(systems.name), asc(parts.displayName), asc(parts.id)),
    listCategories(),
    db.select({ sizes: robots.rawStockSizes }).from(robots).where(eq(robots.id, robotId)),
  ]);
  const itemIds = [...new Set(rows.map((r) => r.inventoryItemId).filter((i): i is string => !!i))];
  const items = itemIds.length
    ? await db
        .select({ id: inventoryItems.id, name: inventoryItems.name, category: inventoryItems.category, specs: inventoryItems.specs, inStock: inventoryItems.inStock, pieces: inventoryItems.pieces })
        .from(inventoryItems)
        .where(inArray(inventoryItems.id, itemIds))
    : [];
  return groupRawStock(
    rows.map(({ displayName, onshapeName, ...r }) => ({ ...r, name: displayName ?? onshapeName ?? "Unnamed part" })),
    items,
    cats,
    robot?.sizes ?? {},
  );
}
