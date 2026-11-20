import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { stationRoom } from "@/config/stations";
import { imageUrl } from "@/lib/storage/r2";
import { fitDevices } from "./moves";
import { centroid, isPanorama, pointInPolygon } from "./places";

const { inventoryDevices, inventoryItems, inventoryLocations } = schema;

// A PC station's PCs (config/stations.ts, Harel 2026-11-20): each one's place on the floor plan
// (workshopMap units), its name, GPU / CPU / RAM (free text), condition (1-5) and note.
export type Device = {
  id: string;
  itemId: string;
  x: number;
  y: number;
  // Its place on the station zone's 360° picture (0..1), null until it's put there.
  panoX: number | null;
  panoY: number | null;
  keyboard: boolean;
  mouse: boolean;
  name: string | null;
  gpu: string | null;
  cpu: string | null;
  ram: string | null;
  note: string | null;
  condition: number | null;
  position: number;
};

const columns = {
  id: inventoryDevices.id,
  itemId: inventoryDevices.itemId,
  x: inventoryDevices.x,
  y: inventoryDevices.y,
  panoX: inventoryDevices.panoX,
  panoY: inventoryDevices.panoY,
  keyboard: inventoryDevices.keyboard,
  mouse: inventoryDevices.mouse,
  name: inventoryDevices.name,
  gpu: inventoryDevices.gpu,
  cpu: inventoryDevices.cpu,
  ram: inventoryDevices.ram,
  note: inventoryDevices.note,
  condition: inventoryDevices.condition,
  position: inventoryDevices.position,
};

// A station's PCs in their order. Its count and its rows agree; should they not (a count set by
// SQL), the rows are made (or trimmed) here the first time the window opens it.
export async function itemDevices(itemId: string): Promise<Device[]> {
  const [rows, [item]] = await Promise.all([
    db.select(columns).from(inventoryDevices).where(eq(inventoryDevices.itemId, itemId)).orderBy(asc(inventoryDevices.position), asc(inventoryDevices.createdAt)),
    db.select({ inStock: inventoryItems.inStock, station: inventoryItems.station }).from(inventoryItems).where(eq(inventoryItems.id, itemId)),
  ]);
  if (!item || rows.length === Math.round(item.inStock)) return rows;
  return db.transaction(async (tx) => {
    const [locked] = await tx.select({ inStock: inventoryItems.inStock }).from(inventoryItems).where(eq(inventoryItems.id, itemId)).for("update");
    if (locked) await fitDevices(tx, itemId, Math.round(locked.inStock), undefined, item.station);
    return tx.select(columns).from(inventoryDevices).where(eq(inventoryDevices.itemId, itemId)).orderBy(asc(inventoryDevices.position), asc(inventoryDevices.createdAt));
  });
}

// Every device of these items (search_inventory), by item.
export async function devicesOf(itemIds: string[]): Promise<Map<string, Device[]>> {
  const out = new Map<string, Device[]>();
  if (!itemIds.length) return out;
  const rows = await db.select(columns).from(inventoryDevices).where(inArray(inventoryDevices.itemId, itemIds)).orderBy(asc(inventoryDevices.position), asc(inventoryDevices.createdAt));
  for (const r of rows) out.set(r.itemId, [...(out.get(r.itemId) ?? []), r]);
  return out;
}

// The 360° picture of a station's room, when a zone inside that room has one (Harel, 2026-11-20:
// the CAD PC window looks round the cage instead of the floor plan). Null: the floor plan.
export type StationPanorama = { zoneId: string; imageUrl: string; imageW: number; imageH: number };
export async function stationPanorama(station: string | null | undefined): Promise<StationPanorama | null> {
  const room = stationRoom(station);
  if (!room) return null;
  const zones = await db
    .select({ id: inventoryLocations.id, outline: inventoryLocations.outline, imageKey: inventoryLocations.imageKey, imageW: inventoryLocations.imageW, imageH: inventoryLocations.imageH, panorama: inventoryLocations.panorama })
    .from(inventoryLocations)
    .where(and(isNull(inventoryLocations.parentId), isNotNull(inventoryLocations.imageKey)))
    .orderBy(asc(inventoryLocations.position), asc(inventoryLocations.name));
  const z = zones.find((r) => {
    if (!r.outline?.length || !r.imageW || !r.imageH) return false;
    const [x, y] = centroid(r.outline);
    return pointInPolygon(x, y, room.points) && isPanorama({ id: r.id, name: "", imageUrl: r.imageKey, imageW: r.imageW, imageH: r.imageH, panorama: r.panorama });
  });
  if (!z?.imageKey || !z.imageW || !z.imageH) return null;
  const url = z.imageKey.startsWith("/") ? z.imageKey : await imageUrl(z.imageKey);
  return url ? { zoneId: z.id, imageUrl: url, imageW: z.imageW, imageH: z.imageH } : null;
}
