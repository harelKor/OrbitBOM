"use server";

import { randomUUID } from "node:crypto";
import { eq, inArray, max, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { STATUSES } from "@/config/statuses";
import { MAP_H, MAP_W } from "@/config/workshopMap";
import { requireCapability } from "@/lib/mode";
import { isUuid } from "@/lib/uuid";
import { MIN_SPOT, ZONE_COLORS, circleOf, isPanorama, isPanoramaPicture, nextSpotName, nextZoneName, placeInUseMessage, type MapPoint, type SpotKind } from "@/lib/inventory/places";
import { StorageNotConfiguredError, deleteObject, objectExists, presignUpload } from "@/lib/storage/r2";

const { inventoryLocations, inventoryItems, inventoryGroups, inventoryCategories, systems } = schema;

export type MapResult = { error?: string; id?: string };

// Settings → Map (Harel, 2026-11-14): admins draw zones on the floor plan, give each its
// first-person picture and pin its drawers and shelves on it. Every change saves at once.
const refresh = () => revalidatePath("/", "layout");

const outlineSchema = z
  .array(z.tuple([z.number().min(-50).max(MAP_W + 50), z.number().min(-50).max(MAP_H + 50)]))
  .min(3)
  .max(64);
const kindSchema = z.enum(["drawer", "shelf", "bin", "zone"]);
const unit = z.number().min(0).max(1);
const size = z.number().min(MIN_SPOT).max(1);
const IMAGE_KEY = /^map\/zones\/[0-9a-f-]{36}\.(webp|jpg)$/;

const round = (pts: MapPoint[]) => pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as MapPoint);

async function zone(id: string) {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(inventoryLocations).where(eq(inventoryLocations.id, id));
  return row && !row.parentId ? row : null;
}

export async function createZone(outline: MapPoint[]): Promise<MapResult> {
  await requireCapability("manage");
  const parsed = outlineSchema.safeParse(outline);
  if (!parsed.success) return { error: "Draw at least three corners on the map." };
  const all = await db.select({ name: inventoryLocations.name, parentId: inventoryLocations.parentId }).from(inventoryLocations);
  const zones = all.filter((p) => !p.parentId).length;
  const [{ top }] = await db.select({ top: max(inventoryLocations.position) }).from(inventoryLocations);
  const [row] = await db
    .insert(inventoryLocations)
    .values({ name: nextZoneName(all.map((p, i) => ({ id: String(i), name: p.name }))), outline: round(parsed.data), color: ZONE_COLORS[zones % ZONE_COLORS.length], position: (top ?? 0) + 1 })
    .returning({ id: inventoryLocations.id });
  refresh();
  return { id: row.id };
}

const zonePatch = z.object({
  outline: outlineSchema.nullable().optional(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  facing: z.number().min(-720).max(720).optional(),
  // A 360° picture or a flat one; null goes back to deciding by its shape.
  panorama: z.boolean().nullable().optional(),
});

export async function updateZone(id: string, patch: z.infer<typeof zonePatch>): Promise<MapResult> {
  await requireCapability("manage");
  const parsed = zonePatch.safeParse(patch);
  if (!parsed.success) return { error: "That change isn't valid." };
  const z0 = await zone(id);
  if (!z0) return { error: "That zone was deleted." };
  const v = parsed.data;
  // Marked as a 360° panorama, the zone becomes a circle of the same area (Harel, 2026-11-20).
  const outline = v.outline !== undefined ? v.outline : v.panorama === true && z0.outline?.length ? circleOf(z0.outline) : undefined;
  await db
    .update(inventoryLocations)
    .set({
      ...(outline !== undefined && { outline: outline ? round(outline) : null }),
      ...(v.color && { color: v.color }),
      ...(v.facing !== undefined && { facing: ((Math.round(v.facing) % 360) + 360) % 360 }),
      ...(v.panorama !== undefined && { panorama: v.panorama }),
    })
    .where(eq(inventoryLocations.id, id));
  refresh();
  return {};
}

// Step 1 of a zone picture: a presigned PUT for the browser's shrunk WebP (JPEG where the
// browser can't write WebP).
export async function startZoneImageUpload(ext: "webp" | "jpg" = "webp"): Promise<{ url: string; key: string } | { error: string }> {
  await requireCapability("manage");
  try {
    const key = `map/zones/${randomUUID()}.${ext === "jpg" ? "jpg" : "webp"}`;
    return { url: await presignUpload(key), key };
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return { error: err.message };
    throw err;
  }
}

// Step 2: the picture becomes the zone's; the old one is removed from storage. Its drawers keep
// their spots (fractions of the picture), so a retaken picture from the same place lines up.
export async function setZoneImage(id: string, key: string | null, size?: { w: number; h: number }): Promise<MapResult> {
  await requireCapability("manage");
  const z0 = await zone(id);
  if (!z0) return { error: "That zone was deleted." };
  if (key !== null) {
    if (!IMAGE_KEY.test(key) || !size || !(size.w > 0 && size.h > 0)) return { error: "Unknown picture." };
    if (!(await objectExists(key))) return { error: "The picture didn't reach file storage. Try again." };
  }
  await db
    .update(inventoryLocations)
    .set({
      imageKey: key,
      imageW: key ? Math.round(size!.w) : null,
      imageH: key ? Math.round(size!.h) : null,
      // A 360° picture (by its shape, unless the zone says otherwise) makes the zone a circle.
      ...(key && z0.panorama == null && isPanoramaPicture(size!.w, size!.h) && z0.outline?.length && { outline: round(circleOf(z0.outline)) }),
    })
    .where(eq(inventoryLocations.id, id));
  if (z0.imageKey && z0.imageKey !== key && !z0.imageKey.startsWith("/")) await deleteObject(z0.imageKey).catch(() => {});
  refresh();
  return {};
}

// What points at a place goes with it: items, groups, category defaults and system drawers on a
// deleted spot move up to its zone; on a deleted zone they lose their place.
async function release(ids: string[], to: string | null) {
  if (!ids.length) return;
  await db.transaction(async (tx) => {
    await tx.update(inventoryItems).set({ locationId: to }).where(inArray(inventoryItems.locationId, ids));
    await tx.update(inventoryGroups).set({ locationId: to }).where(inArray(inventoryGroups.locationId, ids));
    await tx.update(inventoryCategories).set({ defaultLocationId: to }).where(inArray(inventoryCategories.defaultLocationId, ids));
    const rows = await tx.select({ id: systems.id, drawers: systems.drawers }).from(systems).where(sql`${systems.drawers} <> '{}'::jsonb`);
    for (const s of rows) {
      const next: Record<string, string> = {};
      for (const [status, place] of Object.entries(s.drawers)) {
        if (!ids.includes(place)) next[status] = place;
        else if (to) next[status] = to;
      }
      if (Object.keys(next).length !== Object.keys(s.drawers).length || Object.entries(next).some(([k, v]) => s.drawers[k] !== v))
        await tx.update(systems).set({ drawers: next }).where(eq(systems.id, s.id));
    }
    // Doors to a deleted zone lead nowhere until they're pointed elsewhere.
    await tx.update(inventoryLocations).set({ linkId: null }).where(inArray(inventoryLocations.linkId, ids));
    await tx.delete(inventoryLocations).where(inArray(inventoryLocations.id, ids));
  });
}

// A place that still holds items (or item groups) isn't deleted: its items would lose their place
// with no history and no undo (like deleteCategory, the member moves them first).
async function stillHolds(ids: string[], what: string): Promise<string | null> {
  const [[items], [groups]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(inventoryItems).where(inArray(inventoryItems.locationId, ids)),
    db.select({ n: sql<number>`count(*)::int` }).from(inventoryGroups).where(inArray(inventoryGroups.locationId, ids)),
  ]);
  return placeInUseMessage(what, items.n, groups.n);
}

export async function deleteZone(id: string): Promise<MapResult> {
  await requireCapability("manage");
  const z0 = await zone(id);
  if (!z0) return {};
  const spots = await db.select({ id: inventoryLocations.id }).from(inventoryLocations).where(eq(inventoryLocations.parentId, id));
  const held = await stillHolds([id, ...spots.map((s) => s.id)], "This zone");
  if (held) return { error: held };
  await release([id, ...spots.map((s) => s.id)], null);
  if (z0.imageKey && !z0.imageKey.startsWith("/")) await deleteObject(z0.imageKey).catch(() => {});
  refresh();
  return {};
}

export async function addSpot(zoneId: string, at: { x: number; y: number }, kind: SpotKind): Promise<MapResult> {
  await requireCapability("manage");
  const z0 = await zone(zoneId);
  if (!z0) return { error: "That zone was deleted." };
  if (!unit.safeParse(at.x).success || !unit.safeParse(at.y).success || !kindSchema.safeParse(kind).success) return { error: "That spot is off the picture." };
  if (kind === "zone" && !isPanorama({ id: z0.id, name: z0.name, imageUrl: z0.imageKey, imageW: z0.imageW, imageH: z0.imageH, panorama: z0.panorama })) return { error: "Zone doors go on a 360° picture." };
  const all = await db.select({ id: inventoryLocations.id, name: inventoryLocations.name }).from(inventoryLocations);
  const [{ top }] = await db.select({ top: max(inventoryLocations.position) }).from(inventoryLocations).where(eq(inventoryLocations.parentId, zoneId));
  const [row] = await db
    .insert(inventoryLocations)
    .values({ name: nextSpotName(z0, kind, all), parentId: zoneId, spotX: at.x, spotY: at.y, kind, position: (top ?? 0) + 1 })
    .returning({ id: inventoryLocations.id });
  refresh();
  return { id: row.id };
}

// x / y are the tag's centre, w / h its size (Harel, 2026-11-17: tags are rectangles sized to
// the drawer), all fractions of the zone picture.
export async function updateSpot(id: string, patch: { x?: number; y?: number; w?: number; h?: number; kind?: SpotKind; linkId?: string | null }): Promise<MapResult> {
  await requireCapability("manage");
  if (!isUuid(id)) return { error: "Unknown spot." };
  const off = (["x", "y"] as const).some((k) => patch[k] !== undefined && !unit.safeParse(patch[k]).success);
  const badSize = (["w", "h"] as const).some((k) => patch[k] !== undefined && !size.safeParse(patch[k]).success);
  if (off || badSize) return { error: "That spot is off the picture." };
  if (patch.kind !== undefined && !kindSchema.safeParse(patch.kind).success) return { error: "Unknown kind." };
  if (patch.linkId != null) {
    // A door leads to another zone, never to its own.
    const [[spot], [to]] = await Promise.all([
      db.select({ parentId: inventoryLocations.parentId }).from(inventoryLocations).where(eq(inventoryLocations.id, id)),
      isUuid(patch.linkId) ? db.select({ id: inventoryLocations.id, parentId: inventoryLocations.parentId }).from(inventoryLocations).where(eq(inventoryLocations.id, patch.linkId)) : Promise.resolve([]),
    ]);
    if (!to || to.parentId || to.id === spot?.parentId) return { error: "Pick another zone." };
  }
  await db
    .update(inventoryLocations)
    .set({
      ...(patch.x !== undefined && { spotX: patch.x }),
      ...(patch.y !== undefined && { spotY: patch.y }),
      ...(patch.w !== undefined && { spotW: patch.w }),
      ...(patch.h !== undefined && { spotH: patch.h }),
      ...(patch.kind && { kind: patch.kind }),
      ...(patch.linkId !== undefined && { linkId: patch.linkId }),
    })
    .where(eq(inventoryLocations.id, id));
  refresh();
  return {};
}

// Only an empty drawer is deleted; what else points at it (category defaults, system drawers)
// moves up to its zone.
export async function deleteSpot(id: string): Promise<MapResult> {
  await requireCapability("manage");
  if (!isUuid(id)) return {};
  const [row] = await db.select().from(inventoryLocations).where(eq(inventoryLocations.id, id));
  if (!row?.parentId) return {};
  const held = await stillHolds([id], "This spot");
  if (held) return { error: held };
  await release([id], row.parentId);
  refresh();
  return {};
}

// A system's drawer for its parts in one status (Harel, 2026-11-14); null clears it.
export async function setSystemDrawer(systemId: string, status: string, placeId: string | null): Promise<MapResult> {
  await requireCapability("manage");
  if (!isUuid(systemId) || !STATUSES.some((s) => s.name === status)) return { error: "Unknown system or status." };
  if (placeId !== null) {
    if (!isUuid(placeId)) return { error: "Unknown place." };
    const [p] = await db.select({ id: inventoryLocations.id }).from(inventoryLocations).where(eq(inventoryLocations.id, placeId));
    if (!p) return { error: "That place was deleted." };
  }
  await db.transaction(async (tx) => {
    const [s] = await tx.select({ drawers: systems.drawers }).from(systems).where(eq(systems.id, systemId)).for("update");
    if (!s) return;
    const next = { ...s.drawers };
    if (placeId) next[status] = placeId;
    else delete next[status];
    await tx.update(systems).set({ drawers: next }).where(eq(systems.id, systemId));
  });
  refresh();
  return {};
}
