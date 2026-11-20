import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Place } from "@/lib/inventory/places";
import { imageUrl } from "@/lib/storage/r2";

const { inventoryLocations } = schema;

// Every shop map place (zones, then their spots) with each zone picture's link. Not cached: the
// links are signed, and the table is a few dozen rows.
export async function listPlaces(): Promise<Place[]> {
  const rows = await db.select().from(inventoryLocations).orderBy(asc(inventoryLocations.position), asc(inventoryLocations.name));
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
      position: r.position,
    })),
  );
}
