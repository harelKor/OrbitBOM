import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Place } from "@/lib/inventory/places";
import { imageUrl } from "@/lib/storage/r2";
import { cachedQuery } from "./cache";

const { inventoryLocations } = schema;

// Every shop map place (zones, then their spots) with each zone picture's link. The rows are kept
// in the server's memory until a place changes (migration 0112; every Inventory render and stock
// tap read them, audit 2026-11-25 PERF-5); the links are signed after, per call.
export async function listPlaces(): Promise<Place[]> {
  const rows = await cachedQuery(db.select().from(inventoryLocations).orderBy(asc(inventoryLocations.position), asc(inventoryLocations.name)), ["inventory_locations"]);
  return Promise.all(
    rows.map(async (r) => ({
      id: r.id,
      name: r.name,
      parentId: r.parentId,
      outline: r.outline,
      color: r.color,
      imageUrl: r.imageKey ? (r.imageKey.startsWith("/") ? r.imageKey : await imageUrl(r.imageKey)) : null,
      imageW: r.imageW,
      imageH: r.imageH,
      facing: r.facing,
      panorama: r.panorama,
      spotX: r.spotX,
      spotY: r.spotY,
      spotW: r.spotW,
      spotH: r.spotH,
      kind: r.kind,
      linkId: r.linkId,
      position: r.position,
    })),
  );
}
