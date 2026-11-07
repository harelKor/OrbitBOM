import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { groupRawStock, type RawGroup } from "@/lib/fab/rawStock";
import { partKey } from "@/lib/model/assembly";
import { builtStudios } from "@/lib/model/build";
import { partModelFile } from "@/lib/model/part";
import { imageUrl, objectExists, storageConfigured } from "@/lib/storage/r2";
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

// Where each plate part's saved 3D shape is, for the planner to draw its real outline: the robot
// model's Part Studio file, else the part's own preview file. Short-lived links; no Onshape calls.
// Read after the page shows (a GET route), since it checks R2 for files.
export async function rawStockMeshes(robotId: string): Promise<{ partId: string; url: string; onshapePartId: string }[]> {
  if (!storageConfigured()) return [];
  const groups = await robotRawStock(robotId);
  const ids = groups.filter((g) => g.kind === "plate").flatMap((g) => g.parts.map((p) => p.partId));
  if (!ids.length) return [];
  const [rows, built] = await Promise.all([
    db
      .select({ id: parts.id, sourceDid: parts.sourceDid, sourceEid: parts.sourceEid, onshapePartId: parts.onshapePartId, thumbnailRev: parts.thumbnailRev })
      .from(parts)
      .where(inArray(parts.id, ids)),
    builtStudios(robotId),
  ]);
  const files = await Promise.all(
    rows.map(async (r) => {
      if (!r.sourceDid || !r.sourceEid || !r.onshapePartId) return null;
      const file = built.get(partKey(r.sourceDid, r.sourceEid, r.onshapePartId)) ?? ((await objectExists(partModelFile(r))) ? partModelFile(r) : null);
      return file ? { partId: r.id, file, onshapePartId: r.onshapePartId } : null;
    }),
  );
  const found = files.filter((f): f is NonNullable<typeof f> => !!f);
  const urls = new Map(await Promise.all([...new Set(found.map((f) => f.file))].map(async (f) => [f, await imageUrl(f)] as const)));
  return found.flatMap((f) => {
    const url = urls.get(f.file);
    return url ? [{ partId: f.partId, url, onshapePartId: f.onshapePartId }] : [];
  });
}
