import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { fitDevices } from "./moves";

const { inventoryDevices, inventoryItems } = schema;

// A PC station's PCs (config/stations.ts, Harel 2026-11-20): each one's place on the floor plan
// (workshopMap units), its keyboard / mouse ticks, condition (1-5) and note.
export type Device = { id: string; itemId: string; x: number; y: number; keyboard: boolean; mouse: boolean; note: string | null; condition: number | null; position: number };

const columns = {
  id: inventoryDevices.id,
  itemId: inventoryDevices.itemId,
  x: inventoryDevices.x,
  y: inventoryDevices.y,
  keyboard: inventoryDevices.keyboard,
  mouse: inventoryDevices.mouse,
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
