import "server-only";
import { gunzipSync } from "node:zlib";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LayoutData } from "@/db/schema";
import { partKey } from "@/lib/model/assembly";
import { builtStudios } from "@/lib/model/build";
import { decodeMeshes, type Mesh } from "@/lib/model/mesh";
import { flatMesh, flatSource, NeedsOnshapeError, partModelFile } from "@/lib/model/part";
import { OnshapeError } from "@/lib/onshape/client";
import { getObject, imageUrl, objectExists, storageConfigured } from "@/lib/storage/r2";
import { pieceBase, pieceLabel, pieceRows, sortedRows } from "@/lib/inventory/stock";
import { DEFAULT_GAP, DEFAULT_MARGIN, advisePlate, flattenMesh, type FlatGeom, type FlatPart, type Nest, type PlateAdvice, type StockPiece } from "./layout";

const { parts, systems, groupMembers, partGroups, inventoryItems, inventoryLocations, inventoryGroups } = schema;

export type MissingPart = { partId: string; name: string; reason: string };
// A part as the layout window gets it: flat, plus where its saved 3D mesh is (for the preview)
// and whether a member chose its face (`chosen`). A sheet metal part is its flat pattern, and its
// `onshapePartId` the flat body's.
export type BatchPart = FlatPart & { meshUrl: string | null; onshapePartId: string; chosen: boolean };
type Member = { id: string; onshapeConnected: boolean };
export type BatchStock = { itemId: string; name: string; location: string | null; pieces: StockPiece[] } | null;
export type BatchLayout = {
  groupId: string;
  name: string;
  material: string | null;
  parts: BatchPart[];
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
// files, else the part's own preview file). No Onshape calls for those: a part with no cached mesh
// is listed as missing (opening its 3D preview, or building the robot model, caches it). An Onshape
// sheet metal part is laid out as its flat pattern instead of the folded part (Harel, 2026-11-04):
// fetched once per released revision (1 call) when a `member` with Onshape connected opens the
// layout, then read from R2.
export async function batchFlatParts(
  groupId: string,
  member: Member | null = null,
): Promise<{ parts: (FlatPart & { meshFile: string; onshapePartId: string; chosen: boolean })[]; missing: MissingPart[] }> {
  // The faces members chose in the layout window (the batch's saved layout).
  const [group] = await db.select({ saved: partGroups.layoutData }).from(partGroups).where(eq(partGroups.id, groupId));
  const faces = group?.saved?.faces ?? {};
  const rows = await db
    .select({ part: parts, robotId: systems.robotId, assemblyUrl: systems.assemblyUrl })
    .from(groupMembers)
    .innerJoin(parts, eq(parts.id, groupMembers.partId))
    .leftJoin(systems, eq(systems.id, parts.systemId))
    .where(eq(groupMembers.groupId, groupId));
  const missing: MissingPart[] = [];
  const out: (FlatPart & { meshFile: string; onshapePartId: string; chosen: boolean })[] = [];
  if (!storageConfigured()) {
    return { parts: [], missing: rows.map(({ part }) => ({ partId: part.id, name: nameOf(part), reason: "File storage isn't set up." })) };
  }

  // Sheet metal: its flat pattern, side by side.
  const sheetRows = rows.filter((r) => flatSource(r.part, true));
  const flatQueue = [...sheetRows];
  const flatWorker = async () => {
    for (let row = flatQueue.shift(); row; row = flatQueue.shift()) {
      const { part } = row;
      try {
        const got = await flatMesh(row, member, { fab: true, cachedOnly: !member?.onshapeConnected });
        if (!got) {
          missing.push({ partId: part.id, name: nameOf(part), reason: "Sheet metal: its flat pattern isn't saved yet. Connect Onshape on your profile and open Auto Layout again." });
          continue;
        }
        const face = faces[part.id] ?? null;
        const cacheKey = `${got.file}|${got.flatPartId}|${face?.map((n) => n.toFixed(4)).join(",") ?? "auto"}`;
        if (!flatCache.has(cacheKey)) flatCache.set(cacheKey, flattenMesh(got.mesh.positions, got.mesh.indices, face));
        const geom = flatCache.get(cacheKey);
        if (!geom) missing.push({ partId: part.id, name: nameOf(part), reason: "Its flat pattern couldn't be read." });
        else out.push({ ...geom, partId: part.id, name: nameOf(part), quantity: Math.max(1, part.quantity), meshFile: got.file, onshapePartId: got.flatPartId, chosen: !!face, sheetMetal: true });
      } catch (err) {
        if (!(err instanceof OnshapeError || err instanceof NeedsOnshapeError)) throw err;
        missing.push({ partId: part.id, name: nameOf(part), reason: `Sheet metal: ${err.message}` });
      }
    }
  };
  const flats = Promise.all(Array.from({ length: 4 }, flatWorker));

  const robots = [...new Set(rows.map((r) => r.robotId).filter((r): r is string => !!r))];
  const built = new Map<string, Map<string, string>>(await Promise.all(robots.map(async (r) => [r, await builtStudios(r)] as const)));
  const byFile = new Map<string, (typeof rows)[number]["part"][]>();
  const builtFile = ({ part, robotId }: (typeof rows)[number]) =>
    part.sourceDid && part.sourceEid && part.onshapePartId && robotId ? built.get(robotId)?.get(partKey(part.sourceDid, part.sourceEid, part.onshapePartId)) : undefined;
  // Parts the robot model doesn't hold may have their own saved shape: checked side by side,
  // not one R2 request after another.
  const ownFiles = new Map(
    await Promise.all(
      rows
        .filter((r) => !sheetRows.includes(r) && r.part.sourceDid && r.part.sourceEid && r.part.onshapePartId && !builtFile(r))
        .map(async ({ part }) => [part.id, (await objectExists(partModelFile(part))) ? partModelFile(part) : undefined] as const),
    ),
  );
  for (const row of rows) {
    const { part } = row;
    if (sheetRows.includes(row)) continue;
    if (!part.sourceDid || !part.sourceEid || !part.onshapePartId) {
      missing.push({ partId: part.id, name: nameOf(part), reason: "Not from Onshape." });
      continue;
    }
    const file = builtFile(row) ?? ownFiles.get(part.id);
    if (!file) {
      missing.push({ partId: part.id, name: nameOf(part), reason: "No 3D shape saved yet: open its 3D preview once." });
      continue;
    }
    const list = byFile.get(file);
    if (list) list.push(part);
    else byFile.set(file, [part]);
  }

  const queue = [...byFile.entries()];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [file, waiting] = job;
      let meshes: Map<string, Mesh> | null = null;
      for (const part of waiting) {
        const face = faces[part.id] ?? null;
        const cacheKey = `${file}|${part.onshapePartId}|${face?.map((n) => n.toFixed(4)).join(",") ?? "auto"}`;
        if (!flatCache.has(cacheKey)) {
          if (!meshes) {
            const res = await getObject(file);
            if (!res) break;
            const bytes = gunzipSync(new Uint8Array(await res.arrayBuffer()));
            meshes = new Map(decodeMeshes(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).map((m) => [m.partId, m]));
          }
          const mesh = meshes.get(part.onshapePartId!);
          flatCache.set(cacheKey, mesh ? flattenMesh(mesh.positions, mesh.indices, face) : null);
        }
        const geom = flatCache.get(cacheKey);
        if (!geom) missing.push({ partId: part.id, name: nameOf(part), reason: "Its saved 3D shape couldn't be read." });
        else out.push({ ...geom, partId: part.id, name: nameOf(part), quantity: Math.max(1, part.quantity), meshFile: file, onshapePartId: part.onshapePartId!, chosen: !!face });
      }
      for (const p of waiting) {
        if (!out.some((o) => o.partId === p.id) && !missing.some((m) => m.partId === p.id)) missing.push({ partId: p.id, name: nameOf(p), reason: "Its saved 3D shape is gone." });
      }
    }
  };
  await Promise.all([...Array.from({ length: 4 }, worker), flats]);
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
export async function batchLayout(groupId: string, gap = DEFAULT_GAP, margin = DEFAULT_MARGIN, member: Member | null = null): Promise<BatchLayout | null> {
  const [group] = await db.select({ id: partGroups.id, name: partGroups.name, saved: partGroups.layoutData }).from(partGroups).where(eq(partGroups.id, groupId));
  if (!group) return null;
  const [{ parts: flat, missing }, { material, stock }] = await Promise.all([batchFlatParts(groupId, member), batchStock(groupId)]);
  const { advice, nest } = advisePlate(flat, stock?.pieces ?? [], gap, margin);
  // Each part's mesh file, signed for the 3D preview (the same file the layout was read from).
  const parts = await Promise.all(flat.map(async ({ meshFile, ...p }) => ({ ...p, meshUrl: await imageUrl(meshFile) })));
  return { groupId, name: group.name, material, parts, missing, stock, advice, layout: nest, saved: group.saved ?? null };
}
