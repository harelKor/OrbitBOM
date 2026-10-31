import "server-only";
import { gunzipSync } from "node:zlib";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LayoutData } from "@/db/schema";
import { partKey } from "@/lib/model/assembly";
import { builtStudios } from "@/lib/model/build";
import { decodeMeshes, type Mesh } from "@/lib/model/mesh";
import { partModelFile } from "@/lib/model/part";
import { getObject, objectExists, storageConfigured } from "@/lib/storage/r2";
import { pieceBase, pieceLabel, pieceRows, sortedRows } from "@/lib/inventory/stock";
import { DEFAULT_GAP, DEFAULT_MARGIN, advisePlate, flattenMesh, type FlatGeom, type FlatPart, type Nest, type PlateAdvice, type StockPiece } from "./layout";

const { parts, systems, groupMembers, partGroups, inventoryItems, inventoryLocations, inventoryGroups } = schema;

export type MissingPart = { partId: string; name: string; reason: string };
export type BatchStock = { itemId: string; name: string; location: string | null; pieces: StockPiece[] } | null;
export type BatchLayout = {
  groupId: string;
  name: string;
  material: string | null;
  parts: FlatPart[];
  missing: MissingPart[];
  stock: BatchStock;
  advice: PlateAdvice;
  layout: Nest;
  saved: LayoutData | null; // the window's last state and the batch's Onshape assembly
};

// Flat frames by mesh file and part id; a mesh file never changes once written.
const flatCache = new Map<string, FlatGeom | null>();

const nameOf = (p: { displayName: string | null; onshapeName: string | null }) => p.displayName ?? p.onshapeName ?? "Unnamed part";

// The batch's parts laid flat, from the 3D meshes already in R2 (the robot model's Part Studio
// files, else the part's own preview file). No Onshape calls: a part with no cached mesh is listed
// as missing (opening its 3D preview, or building the robot model, caches it).
export async function batchFlatParts(groupId: string): Promise<{ parts: FlatPart[]; missing: MissingPart[] }> {
  const rows = await db
    .select({ part: parts, robotId: systems.robotId })
    .from(groupMembers)
    .innerJoin(parts, eq(parts.id, groupMembers.partId))
    .leftJoin(systems, eq(systems.id, parts.systemId))
    .where(eq(groupMembers.groupId, groupId));
  const missing: MissingPart[] = [];
  const out: FlatPart[] = [];
  if (!storageConfigured()) {
    return { parts: [], missing: rows.map(({ part }) => ({ partId: part.id, name: nameOf(part), reason: "File storage isn't set up." })) };
  }

  const robots = [...new Set(rows.map((r) => r.robotId).filter((r): r is string => !!r))];
  const built = new Map<string, Map<string, string>>(await Promise.all(robots.map(async (r) => [r, await builtStudios(r)] as const)));
  const byFile = new Map<string, (typeof rows)[number]["part"][]>();
  for (const { part, robotId } of rows) {
    if (!part.sourceDid || !part.sourceEid || !part.onshapePartId) {
      missing.push({ partId: part.id, name: nameOf(part), reason: "Not from Onshape." });
      continue;
    }
    const key = partKey(part.sourceDid, part.sourceEid, part.onshapePartId);
    let file = robotId ? built.get(robotId)?.get(key) : undefined;
    if (!file) {
      const own = partModelFile(part);
      if (await objectExists(own)) file = own;
    }
    if (!file) {
      missing.push({ partId: part.id, name: nameOf(part), reason: "No 3D shape saved yet: open its 3D preview once." });
      continue;
    }
    byFile.set(file, [...(byFile.get(file) ?? []), part]);
  }

  const queue = [...byFile.entries()];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [file, waiting] = job;
      let meshes: Map<string, Mesh> | null = null;
      for (const part of waiting) {
        const cacheKey = `${file}|${part.onshapePartId}`;
        if (!flatCache.has(cacheKey)) {
          if (!meshes) {
            const res = await getObject(file);
            if (!res) break;
            const bytes = gunzipSync(new Uint8Array(await res.arrayBuffer()));
            meshes = new Map(decodeMeshes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).map((m) => [m.partId, m]));
          }
          const mesh = meshes.get(part.onshapePartId!);
          flatCache.set(cacheKey, mesh ? flattenMesh(mesh.positions, mesh.indices) : null);
        }
        const geom = flatCache.get(cacheKey);
        if (!geom) missing.push({ partId: part.id, name: nameOf(part), reason: "Its saved 3D shape couldn't be read." });
        else out.push({ ...geom, partId: part.id, name: nameOf(part), quantity: Math.max(1, part.quantity) });
      }
      for (const p of waiting) {
        if (!flatCache.has(`${file}|${p.onshapePartId}`)) missing.push({ partId: p.id, name: nameOf(p), reason: "Its saved 3D shape is gone." });
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const order = new Map(rows.map((r, i) => [r.part.id, i]));
  out.sort((a, b) => order.get(a.partId)! - order.get(b.partId)!);
  return { parts: out, missing };
}

// The shelf's pieces of the batch's material: the inventory item most of its parts are linked to,
// else an item named like their material.
export async function batchStock(groupId: string): Promise<{ material: string | null; stock: BatchStock }> {
  const rows = await db
    .select({ itemId: parts.inventoryItemId, material: parts.material })
    .from(groupMembers)
    .innerJoin(parts, eq(parts.id, groupMembers.partId))
    .where(eq(groupMembers.groupId, groupId));
  const most = <T,>(xs: T[]) => {
    const n = new Map<T, number>();
    xs.forEach((x) => n.set(x, (n.get(x) ?? 0) + 1));
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const material = most(rows.map((r) => r.material).filter((m): m is string => !!m)) ?? null;
  const itemId = most(rows.map((r) => r.itemId).filter((m): m is string => !!m));
  const cols = { id: inventoryItems.id, name: inventoryItems.name, specs: inventoryItems.specs, inStock: inventoryItems.inStock, pieces: inventoryItems.pieces, location: inventoryLocations.name, groupLocation: inventoryGroups.locationId };
  const base = db
    .select(cols)
    .from(inventoryItems)
    .leftJoin(inventoryLocations, eq(inventoryLocations.id, inventoryItems.locationId))
    .leftJoin(inventoryGroups, eq(inventoryGroups.id, inventoryItems.groupId));
  const [item] = itemId ? await base.where(eq(inventoryItems.id, itemId)) : material ? await base.where(eq(inventoryItems.name, material)) : [];
  if (!item) return { material, stock: null };
  let location = item.location;
  if (!location && item.groupLocation) {
    const [loc] = await db.select({ name: inventoryLocations.name }).from(inventoryLocations).where(inArray(inventoryLocations.id, [item.groupLocation]));
    location = loc?.name ?? null;
  }
  const pb = pieceBase(item.specs, item.name);
  const rowsNow = sortedRows(pieceRows(item.inStock, item.pieces, pb), pb);
  const pieces: StockPiece[] = rowsNow.flatMap((r) => {
    const { primary, sub } = pieceLabel(r.size, pb);
    const m = /^(\d+(?:\.\d+)?)×(\d+(?:\.\d+)?)$/.exec(primary);
    if (!m) return [];
    return [{ size: r.size, label: primary, share: sub, x: Number(m[1]), y: Number(m[2]), count: r.count }];
  });
  return { material, stock: { itemId: item.id, name: item.name, location, pieces } };
}

// The batch laid out on the smallest stock piece that takes it all (or a default sheet).
export async function batchLayout(groupId: string, gap = DEFAULT_GAP, margin = DEFAULT_MARGIN): Promise<BatchLayout | null> {
  const [group] = await db.select({ id: partGroups.id, name: partGroups.name, saved: partGroups.layoutData }).from(partGroups).where(eq(partGroups.id, groupId));
  if (!group) return null;
  const [{ parts: flat, missing }, { material, stock }] = await Promise.all([batchFlatParts(groupId), batchStock(groupId)]);
  const { advice, nest } = advisePlate(flat, stock?.pieces ?? [], gap, margin);
  return { groupId, name: group.name, material, parts: flat, missing, stock, advice, layout: nest, saved: group.saved ?? null };
}
