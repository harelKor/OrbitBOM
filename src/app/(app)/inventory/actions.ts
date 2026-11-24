"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { COTS_DEFAULT_STATUS, COTS_IN_STOCK, COTS_ORDERED, COTS_RELEASED, cotsStatusOf } from "@/config/cots";
import { guessCategory, isCategoryGroup } from "@/config/inventory";
import { MAP_H, MAP_W } from "@/config/workshopMap";
import { vendorOfUrl } from "@/config/vendors";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { requireCapability } from "@/lib/mode";
import { listBomTargets } from "@/lib/data/robots";
import { listBores } from "@/lib/data/bores";
import { listCategories } from "@/lib/data/categories";
import { inventoryItemWithLists, itemHistory, itemOrderHistory, listFitTargets, listInventory, robotInventory, usageOf } from "@/lib/data/inventory";
import { autoLink } from "@/lib/inventory/autolink";
import { categoryOf, getCategory, rawSizeProblem, slugify, storedBoreField, type InvCategory } from "@/lib/inventory/categories";
import type { ImportRow } from "@/lib/inventory/import";
import { pushItemToCards } from "@/lib/inventory/cotsSync";
import { recordItemChanges } from "@/lib/inventory/history";
import { editPieces, editVariants, moveStock, setStock } from "@/lib/inventory/moves";
import type { VariantOp } from "@/lib/inventory/variants";
import { readProduct, saveProductPhoto, toUsd } from "@/lib/inventory/product";
import { missing, newestOpenOrders, orderHref } from "@/lib/inventory/season";
import { type PieceOp, SIZE_KEY, parseStock, snapStock } from "@/lib/inventory/stock";
import { applyEachPartChanges } from "@/lib/parts/apply";
import { StorageNotConfiguredError, deleteObject, objectExists, presignUpload } from "@/lib/storage/r2";
import { deleteToTrash } from "@/lib/trash";
import { createItem } from "@/lib/inventory/create";
import { itemDevices, stationPanorama } from "@/lib/inventory/devices";
import { isUuid } from "@/lib/uuid";

const { inventoryItems, inventoryGroups, inventoryConditions, inventoryLocations, inventoryCategories, parts } = schema;

export type ActionResult = { error?: string; message?: string };

// Inventory edits refresh the Inventory pages only. An edit that changes COTS cards refreshes
// /cots too, and one that changes BOM parts the robot pages (Harel, 2026-10-29).
const refresh = (also: { cots?: boolean; robots?: boolean } = {}) => {
  revalidatePath("/inventory");
  if (also.robots) revalidatePath("/robots", "layout");
  if (also.cots) revalidatePath("/cots", "layout");
};

// Work that can take seconds runs after the reply, so a save answers at once: a product's
// picture is downloaded from the shop's site and copied to R2, then parts with the same product
// link or Onshape part (or a matching picture) are auto-linked into To Review. Both show on the
// item's next load.
function finishLater(itemId: string, memberId: string, imageUrl?: string | null) {
  after(async () => {
    try {
      if (imageUrl) {
        const key = await saveProductPhoto(itemId, imageUrl);
        if (key) await db.update(inventoryItems).set({ imagePath: key }).where(eq(inventoryItems.id, itemId));
      }
    } catch {}
    await autoLink({ itemIds: [itemId] }, { memberId, via: "ui" }).catch(() => {});
  });
}

// Photos members take or upload go straight from the browser to R2 under this prefix.
const PHOTO_KEY = /^inventory\/photos\/[0-9a-f-]{36}\.jpg$/;

const linkSchema = z.object({ url: z.url("A product link must be a web link."), site: z.string().trim().max(80).optional() });
const itemInput = z.object({
  name: z.string().trim().min(1, "Part name is required.").max(200),
  category: z.string().nullable(),
  specs: z.record(z.string(), z.string()).default({}),
  inStock: z.string().optional(), // left out on an edit: the stock stays as it is
  conditionId: z.string().nullable().refine((v) => v === null || isUuid(v), "Unknown condition."),
  locationId: z.string().nullable().refine((v) => v === null || isUuid(v), "Unknown location."),
  links: z.array(linkSchema).max(10).default([]),
  price: z.number().min(0).nullable().default(null),
  imageUrl: z.string().nullable().optional(), // a product's picture, copied to R2 on save
  photoKey: z.string().regex(PHOTO_KEY, "Unknown photo.").nullable().optional(), // a photo the member uploaded (wins over imageUrl)
  note: z.string().max(2000).nullable().optional(), // left out: the note stays as it is
});
export type ItemInput = z.input<typeof itemInput>;

// Add or edit an item. Only the category's own fields are kept; the stock changes as a counted
// move. Returns the item's id. The product picture and auto-linking finish after the reply.
export async function saveItem(itemId: string | null, input: ItemInput): Promise<ActionResult & { id?: string }> {
  const member = await requireCapability("work");
  const parsed = itemInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (itemId && !isUuid(itemId)) return { error: "Unknown item." };
  const d = parsed.data;
  const cats = await listCategories();
  const cat = getCategory(cats, d.category);
  if (d.category && !cat) return { error: "Unknown category." };
  const ids = new Set(cat?.fields.map((f) => f.id) ?? []);
  const specs = Object.fromEntries(Object.entries(d.specs).flatMap(([k, v]) => (ids.has(k) && v.trim() ? [[k, v.trim()]] : [])));
  const sizeProblem = rawSizeProblem(cat, specs);
  if (sizeProblem) return { error: sizeProblem };
  const sheet = !!getCategory(cats, categoryOf({ category: d.category, name: d.name }, cats))?.sheet;
  const inStock = d.inStock === undefined ? undefined : parseStock(d.inStock, sheet);
  if (inStock === null) return { error: sheet ? 'In stock is sheets, like "2" or "1 3/4".' : "In stock is a whole number." };
  const cotsLinks = d.links.map((l) => ({ url: l.url, site: l.site || vendorOfUrl(l.url) }));
  const values = {
    name: d.name,
    category: d.category,
    specs,
    conditionId: d.conditionId,
    locationId: d.locationId,
    cotsLinks,
    price: d.price,
    ...(d.note !== undefined && { note: d.note?.trim() || null }),
  };
  const ctx = { memberId: member.id, via: "ui" as const };
  const defective = await isUncounted(d.conditionId);
  const id = await db.transaction(async (tx) => {
    let id = itemId;
    if (id) {
      const [before] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, id)).for("update");
      if (!before) return null;
      // A PC station keeps its name and category (config/stations.ts).
      if (before.station) Object.assign(values, { name: before.name, category: before.category });
      await tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, id));
      await recordItemChanges(tx, id, before, values, ctx);
      // Its COTS cards show the same product.
      await pushItemToCards(tx, id, {
        ...(before.name !== values.name && { name: values.name }),
        ...(JSON.stringify(before.cotsLinks) !== JSON.stringify(values.cotsLinks) && { cotsLinks: values.cotsLinks }),
        ...(before.price !== values.price && { price: values.price }),
      });
      if (inStock !== undefined) await setStock(tx, id, inStock, ctx);
    } else {
      id = await createItem(tx, values, inStock ?? 0, ctx);
    }
    if (defective) await editVariants(tx, id!, { whole: d.conditionId! }, ctx);
    return id!;
  });
  if (!id) return { error: "That item was deleted." };
  const error = d.photoKey ? await applyPhoto(id, d.photoKey, ctx) : null;
  finishLater(id, member.id, d.photoKey ? null : d.imageUrl);
  // An edit can change its COTS cards' name, links and price.
  refresh({ cots: !!itemId });
  return error ? { id, error } : { id };
}

const linkMessage = (n: number) => `${n} BOM part${n === 1 ? " looks" : "s look"} like this item; ${n === 1 ? "it waits" : "they wait"} in To Review for Approve.`;

// The item window's "Find BOM parts": auto-link for this one item.
export async function findBomParts(itemId: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId)) return { error: "Unknown item." };
  const n = await autoLink({ itemIds: [itemId] }, { memberId: member.id, via: "ui" });
  refresh({ robots: true });
  return { message: n ? linkMessage(n) : "No new BOM part looks like this item. Parts already waiting in To Review, and links someone rejected, aren't suggested again." };
}

// Step 1 of a photo: a presigned PUT for the browser's shrunk JPEG.
export async function startPhotoUpload(): Promise<{ url: string; key: string } | { error: string }> {
  await requireCapability("work");
  try {
    const key = `inventory/photos/${randomUUID()}.jpg`;
    return { url: await presignUpload(key), key };
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return { error: err.message };
    throw err;
  }
}

// Step 2, from the item window: the uploaded photo becomes the item's picture.
export async function setItemPhoto(itemId: string, key: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId) || !PHOTO_KEY.test(key)) return { error: "Unknown photo." };
  const error = await applyPhoto(itemId, key, { memberId: member.id, via: "ui" });
  refresh();
  return error ? { error } : {};
}

async function applyPhoto(itemId: string, key: string, ctx: { memberId: string; via: "ui" }) {
  if (!(await objectExists(key))) return "The photo didn't reach file storage. Try again.";
  const [before] = await db.select({ imagePath: inventoryItems.imagePath }).from(inventoryItems).where(eq(inventoryItems.id, itemId));
  if (!before) return "That item was deleted.";
  await db.update(inventoryItems).set({ imagePath: key }).where(eq(inventoryItems.id, itemId));
  await recordItemChanges(db, itemId, before, { imagePath: key }, ctx);
  if (before.imagePath && before.imagePath !== key) await deleteObject(before.imagePath).catch(() => {});
  return null;
}

// The item window's ⋯ > Delete photo: the item goes back to its category's picture (or a linked
// part's CAD picture). The stored file is removed unless something else still shows it.
export async function removeItemPhoto(itemId: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId)) return { error: "Unknown item." };
  const [before] = await db.select({ imagePath: inventoryItems.imagePath }).from(inventoryItems).where(eq(inventoryItems.id, itemId));
  if (!before) return { error: "That item was deleted." };
  if (!before.imagePath) return { error: "This picture comes from a BOM part's CAD, so there's no photo to delete." };
  await db.update(inventoryItems).set({ imagePath: null }).where(eq(inventoryItems.id, itemId));
  await recordItemChanges(db, itemId, before, { imagePath: null }, { memberId: member.id, via: "ui" });
  const key = before.imagePath;
  if (!/^(thumbs|thumbnails)\//.test(key)) {
    const [shared] = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.imagePath, key)).limit(1);
    if (!shared) await deleteObject(key).catch(() => {});
  }
  refresh();
  return { message: "Photo deleted." };
}

// Deleting items is "discard": any team member, not only admins (Harel, 2026-11-19).
export async function deleteItem(itemId: string): Promise<ActionResult> {
  const member = await requireCapability("discard");
  if (!isUuid(itemId)) return { error: "Unknown item." };
  const error = await trashItems([itemId], member.id);
  refresh();
  return error ? { error } : {};
}

// The Inventory page's Delete mode.
export async function bulkDeleteItems(itemIds: string[]): Promise<ActionResult> {
  const member = await requireCapability("discard");
  if (!itemIds.length || itemIds.some((id) => !isUuid(id))) return { error: "Unknown item." };
  const error = await trashItems(itemIds, member.id);
  if (error) return { error };
  refresh();
  return { message: `Deleted ${itemIds.length} item${itemIds.length === 1 ? "" : "s"}. An admin can bring them back from Settings → Recently deleted.` };
}

// Each item goes to Recently deleted on its own (with its stock moves, history and orders, and
// the parts that were linked to it), so one can come back without the others.
// The three PC stations (config/stations.ts) can't be deleted: the answer says so and nothing goes.
async function trashItems(itemIds: string[], memberId: string): Promise<string | null> {
  const items = await db.select({ id: inventoryItems.id, name: inventoryItems.name, station: inventoryItems.station }).from(inventoryItems).where(inArray(inventoryItems.id, itemIds));
  const fixed = items.filter((i) => i.station);
  if (fixed.length) return `${fixed.map((i) => i.name).join(", ")} ${fixed.length === 1 ? "is a PC station and can't" : "are PC stations and can't"} be deleted.`;
  await db.transaction(async (tx) => {
    for (const item of items) {
      await deleteToTrash(tx, { kind: "item", label: item.name, root: inventoryItems, where: eq(inventoryItems.id, item.id), memberId });
    }
  });
  return null;
}

// The Inventory page's Move mode: a new category and / or location for every selected item.
// A field left out stays as it is; null clears the location. Work, like one item's category or
// location, so CAD and Build move items too (Harel, 2026-11-19).
export async function bulkMoveItems(itemIds: string[], target: { category?: string | null; locationId?: string | null }): Promise<ActionResult> {
  return moveItems(await requireCapability("work"), itemIds, target);
}

async function moveItems(member: { id: string }, itemIds: string[], target: { category?: string | null; locationId?: string | null }): Promise<ActionResult> {
  if (!itemIds.length || itemIds.some((id) => !isUuid(id))) return { error: "Unknown item." };
  const values: { category?: string | null; locationId?: string | null } = {};
  if (target.category !== undefined) {
    if (target.category && !getCategory(await listCategories(), target.category)) return { error: "Unknown category." };
    values.category = target.category;
  }
  if (target.locationId !== undefined) {
    if (target.locationId !== null && !isUuid(target.locationId)) return { error: "Unknown location." };
    values.locationId = target.locationId;
  }
  if (!Object.keys(values).length) return { error: "Pick a category or a location." };
  const ctx = { memberId: member.id, via: "ui" as const };
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(inventoryItems).where(inArray(inventoryItems.id, itemIds)).for("update");
    for (const before of rows) {
      await tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, before.id));
      await recordItemChanges(tx, before.id, before, values, ctx);
    }
  });
  refresh();
  return { message: `Moved ${itemIds.length} item${itemIds.length === 1 ? "" : "s"}.` };
}

// An item's category, on its own.
export async function setItemCategory(itemId: string, categoryId: string): Promise<ActionResult> {
  return moveItems(await requireCapability("work"), [itemId], { category: categoryId });
}

// The item window's location pill and the card's and table's location; null clears it.
export async function setItemLocation(itemId: string, locationId: string | null): Promise<ActionResult> {
  return moveItems(await requireCapability("work"), [itemId], { locationId });
}

// The item window's condition pill; null clears it.
export async function setItemCondition(itemId: string, conditionId: string | null): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId) || (conditionId !== null && !isUuid(conditionId))) return { error: "Unknown condition." };
  const out = await saveFields(itemId, () => ({ conditionId }), member.id);
  if (!out.error && (await isUncounted(conditionId))) {
    await db.transaction((tx) => editVariants(tx, itemId, { whole: conditionId! }, { memberId: member.id, via: "ui" }));
  }
  return out;
}

// Defective (lib/inventory/variants.ts): an item put in it holds its stock as one Defective
// variant, so it counts toward nothing.
async function isUncounted(conditionId: string | null) {
  if (!conditionId) return false;
  const [c] = await db.select({ uncounted: inventoryConditions.uncounted }).from(inventoryConditions).where(eq(inventoryConditions.id, conditionId));
  return !!c?.uncounted;
}

// The 2026 / 2027 season tag on the card, table and item window: flips it, or sets nextTag.
export async function toggleItemSeasonTag(itemId: string, nextTag?: "2026" | "2027"): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId) || (nextTag !== undefined && nextTag !== "2026" && nextTag !== "2027")) return { error: "Unknown item." };
  return saveFields(itemId, (before) => ({ seasonTag: nextTag ?? (before.seasonTag === "2027" ? "2026" : "2027") }), member.id);
}

// An item's specs, on their own: only the category's own fields are kept, blanks dropped.
export async function setItemSpecs(itemId: string, specs: Record<string, string>): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId)) return { error: "Unknown item." };
  const cats = await listCategories();
  // Raw Stock sizes: X, Y and wall filled in, Y no bigger than X (rawSizeProblem).
  const [item] = await db.select({ category: inventoryItems.category, name: inventoryItems.name }).from(inventoryItems).where(eq(inventoryItems.id, itemId));
  const sizeProblem = item && rawSizeProblem(getCategory(cats, categoryOf(item, cats)), specs);
  if (sizeProblem) return { error: sizeProblem };
  return saveFields(
    itemId,
    (before) => {
      const ids = new Set(getCategory(cats, before.category)?.fields.map((f) => f.id) ?? []);
      return { specs: Object.fromEntries(Object.entries(specs).flatMap(([k, v]) => (ids.has(k) && v.trim() ? [[k, v.trim().slice(0, 200)]] : []))) };
    },
    member.id,
  );
}

// The ✕ next to a "Buy at" link: the link goes; with no link left the price goes too.
// Linked COTS cards show the same.
export async function unlinkItemProduct(itemId: string, url: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId)) return { error: "Unknown item." };
  return saveFields(
    itemId,
    (before) => {
      const cotsLinks = before.cotsLinks.filter((l) => l.url !== url);
      return { cotsLinks, ...(!cotsLinks.length && { price: null }) };
    },
    member.id,
    true,
  );
}

// One item's fields changed in place, with its history (and its COTS cards when asked).
async function saveFields(
  itemId: string,
  change: (before: typeof inventoryItems.$inferSelect) => Partial<typeof inventoryItems.$inferInsert>,
  memberId: string,
  cards = false,
): Promise<ActionResult> {
  const ok = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).for("update");
    if (!before) return false;
    const values = change(before);
    await tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, itemId));
    await recordItemChanges(tx, itemId, before, values, { memberId, via: "ui" });
    if (cards) await pushItemToCards(tx, itemId, values);
    return true;
  });
  if (!ok) return { error: "That item was deleted." };
  refresh({ cots: cards });
  return {};
}

// The item window's product search: the product becomes the item's first link, its price the
// item's, its picture the item's photo (after the reply); linked COTS cards show the same product.
const productSchema = z.object({
  url: z.url("A product link must be a web link."),
  site: z.string().trim().max(80).optional(),
  price: z.number().min(0).nullable().optional(),
  imageUrl: z.string().nullable().optional(),
});
export async function linkItemToProduct(itemId: string, product: z.input<typeof productSchema>): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId)) return { error: "Unknown item." };
  const parsed = productSchema.safeParse(product);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const p = parsed.data;
  const ctx = { memberId: member.id, via: "ui" as const };
  const ok = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).for("update");
    if (!before) return false;
    const link = { url: p.url, site: p.site || vendorOfUrl(p.url) };
    const cotsLinks = [link, ...before.cotsLinks.filter((l) => l.url !== p.url)].slice(0, 10);
    const values = { cotsLinks, ...(p.price != null && { price: p.price }) };
    await tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, itemId));
    await recordItemChanges(tx, itemId, before, values, ctx);
    await pushItemToCards(tx, itemId, values);
    return true;
  });
  if (!ok) return { error: "That item was deleted." };
  finishLater(itemId, member.id, p.imageUrl);
  refresh({ cots: true });
  return { message: "Linked the product." };
}

// The − / + stepper (a fraction item also steps one piece of a size: "f6", "m450", "p500x450").
// `variantId`: the variant an item with variants steps (the card asks which).
export async function adjustStock(itemId: string, delta: number, size?: string, variantId?: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId) || !Number.isFinite(delta) || !delta) return { error: "Unknown item." };
  if (size !== undefined && !SIZE_KEY.test(size)) return { error: "Unknown piece size." };
  if (variantId !== undefined && !isUuid(variantId)) return { error: "Unknown variant." };
  const cats = await listCategories(); // cached, read before the transaction
  await db.transaction((tx) => moveStock(tx, { itemId, delta, reason: delta > 0 ? "received" : "used", size, variantId }, { memberId: member.id, via: "ui", cats }));
  refresh();
  return {};
}

// A fraction item's Spread: a size's count, a size changed or removed, a new size.
export async function editItemPieces(itemId: string, op: PieceOp): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId) || !SIZE_KEY.test(op.size) || (op.kind === "rename" && !SIZE_KEY.test(op.to))) return { error: "Unknown piece size." };
  if (op.kind === "count" && (!Number.isInteger(op.count) || op.count < 0 || op.count > 100000)) return { error: "Type a whole number of pieces." };
  const cats = await listCategories();
  await db.transaction((tx) => editPieces(tx, itemId, op, { memberId: member.id, via: "ui", cats }));
  refresh();
  return {};
}

// A PC station's PC Delete (Harel, 2026-11-20): gone for good (not Recently deleted), a −1 move in
// the item's history. + Add PC is adjustStock: a new PC in the middle of the station's room.
export async function removeDevice(itemId: string, deviceId: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId) || !isUuid(deviceId)) return { error: "Unknown device." };
  const cats = await listCategories();
  await db.transaction((tx) => moveStock(tx, { itemId, delta: -1, reason: "counted", deviceId }, { memberId: member.id, via: "ui", cats }));
  refresh();
  return {};
}

const devicePatch = z
  .object({
    // Floor plan units (config/workshopMap.ts).
    x: z.number().min(0).max(MAP_W),
    y: z.number().min(0).max(MAP_H),
    // Its place on the station zone's 360° picture, 0..1 of the picture.
    panoX: z.number().min(0).max(1),
    panoY: z.number().min(0).max(1),
    note: z.string().max(2000).nullable(),
    condition: z.number().int().min(1).max(5).nullable(),
    name: z.string().max(80).nullable(),
    gpu: z.string().max(200).nullable(),
    cpu: z.string().max(200).nullable(),
    ram: z.string().max(200).nullable(),
  })
  .partial();

// A PC's place on the floor plan (saved on drop), its note and condition.
export async function updateDevice(deviceId: string, patch: z.input<typeof devicePatch>): Promise<ActionResult> {
  await requireCapability("work");
  const parsed = devicePatch.safeParse(patch);
  if (!isUuid(deviceId) || !parsed.success) return { error: "Unknown device." };
  const { x, y, panoX, panoY, condition, ...texts } = parsed.data;
  // Text fields: blank clears them; names and parts are one line.
  const tidy = Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, (k === "note" ? v?.trim() : v?.replace(/\s+/g, " ").trim()) || null]));
  const done = await db
    .update(schema.inventoryDevices)
    .set({ x, y, panoX, panoY, condition, ...tidy, updatedAt: new Date() })
    .where(eq(schema.inventoryDevices.id, deviceId))
    .returning({ id: schema.inventoryDevices.id });
  return done.length ? {} : { error: "That PC was deleted." };
}

// The count typed on a card or in the item window: a "Counted" move of the difference.
export async function countStock(itemId: string, amount: number): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId) || !Number.isFinite(amount) || amount < 0) return { error: "Type a count of 0 or more." };
  const cats = await listCategories();
  await db.transaction((tx) => setStock(tx, itemId, amount, { memberId: member.id, via: "ui", cats }));
  refresh();
  return {};
}

const uuidStr = z.string().refine(isUuid);
const variantOp = z.union([
  z.object({ add: z.object({ conditionId: uuidStr.nullable(), count: z.number().int().min(0).max(100000), note: z.string().max(200).nullable().optional() }) }),
  z.object({ set: z.object({ id: uuidStr, conditionId: uuidStr.nullable().optional(), count: z.number().int().min(0).max(100000).optional(), note: z.string().max(200).nullable().optional() }) }),
  z.object({ remove: uuidStr }),
]);

// The item window's variants (Harel, 2026-11-24): + Add variant, a variant's condition, count and
// note, ✕. Stock changes are moves (lib/inventory/moves.ts); Raw Stock has no variants.
export async function editItemVariants(itemId: string, op: VariantOp): Promise<ActionResult> {
  const member = await requireCapability("work");
  const parsed = variantOp.safeParse(op);
  if (!isUuid(itemId) || !parsed.success) return { error: "Unknown variant." };
  const cats = await listCategories();
  const done = await db.transaction((tx) => editVariants(tx, itemId, parsed.data as VariantOp, { memberId: member.id, via: "ui", cats }));
  if (!done) return { error: "That item was deleted." };
  refresh();
  return {};
}

// An item's new name on its own, kept in the item's history.
export async function setItemName(itemId: string, name: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId)) return { error: "Unknown item." };
  const value = name.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!value) return { error: "An item needs a name." };
  return saveFields(itemId, () => ({ name: value }), member.id, true);
}

// The item window's Notes box: blank clears the note.
export async function setItemNote(itemId: string, note: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId)) return { error: "Unknown item." };
  const value = note.trim().slice(0, 2000) || null;
  const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId));
  if (!item) return { error: "That item was deleted." };
  if (value === item.note) return {};
  await db.transaction(async (tx) => {
    await tx.update(inventoryItems).set({ note: value }).where(eq(inventoryItems.id, itemId));
    await recordItemChanges(tx, itemId, item, { note: value }, { memberId: member.id, via: "ui" });
  });
  refresh();
  return {};
}

// The item window's "Needed for season": blank or 0 clears it (the item leaves the Season view).
export async function setSeasonNeed(itemId: string, text: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(itemId)) return { error: "Unknown item." };
  const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId));
  if (!item) return { error: "That item was deleted." };
  const cats = await listCategories();
  const sheet = !!getCategory(cats, categoryOf(item, cats))?.sheet;
  const n = parseStock(text, sheet);
  if (n === null) return { error: sheet ? 'Needed for season is sheets, like "2" or "1 3/4".' : "Needed for season is a whole number." };
  const seasonNeed = n > 0 ? n : null;
  if (seasonNeed === item.seasonNeed) return {};
  await db.transaction(async (tx) => {
    await tx.update(inventoryItems).set({ seasonNeed }).where(eq(inventoryItems.id, itemId));
    await recordItemChanges(tx, itemId, item, { seasonNeed }, { memberId: member.id, via: "ui" });
  });
  refresh();
  return {};
}

// The cart on a short item's card: a General COTS card for what's missing goes to Released,
// List, what the shelf still misses (up to its quantity) goes on the shelf.
// List its whole quantity goes on the shelf.
export async function sendItemToReleased(itemId: string): Promise<ActionResult & { href?: string }> {
  const member = await requireCapability("work");
  if (!isUuid(itemId)) return { error: "Unknown item." };
  const { items } = await listInventory();
  const item = items.find((i) => i.id === itemId);
  if (!item) return { error: "That item was deleted." };
  if (item.openOrder) return { href: orderHref(item.openOrder) };
  const quantity = missing(item, "any");
  if (!quantity) return { error: "Nothing is missing: the shelf already has what's needed." };
  // Two quick presses: the item stays locked until the first card is in, so the second finds it.
  const sent = await db.transaction(async (tx) => {
    await tx.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.id, item.id)).for("update");
    const cards = await tx
      .select({ partId: parts.id, designState: parts.designState, systemId: parts.systemId, restock: parts.restock, at: parts.createdAt })
      .from(parts)
      .where(and(eq(parts.inventoryItemId, item.id), isNull(parts.removedFromCadAt), eq(parts.classification, "cots")));
    const open = newestOpenOrders(cards.map((c) => ({ ...c, itemId: item.id, status: cotsStatusOf(c.designState) }))).get(item.id);
    if (open) return { open };
    const [card] = await tx
      .insert(parts)
      .values({
        systemId: null,
        robotId: null,
        isManual: true,
        displayName: item.name,
        classification: "cots",
        classSource: "manual",
        inventoryItemId: item.id,
        cotsLinks: item.cotsLinks,
        unitPrice: item.price,
        cotsCategory: item.category,
        quantity,
        restock: true,
        designState: COTS_RELEASED,
        stageAt: new Date(), // arrives in COTS Released (src/lib/seen.ts)
        lastModifiedBy: member.id,
      })
      .returning({ id: parts.id });
    return { card };
  });
  if (sent.open) return { href: orderHref(sent.open) };
  refresh({ cots: true });
  return { message: `Sent ${quantity} ${item.name} to Released.`, href: orderHref({ partId: sent.card.id, status: COTS_RELEASED }) };
}

// A linked COTS card's − / +: the units go on or come off its item's shelf. Like the card's own
// count, reaching the quantity sets the part In Stock (parts the new unit now fully covers).
export async function stepShelfStock(partIds: string[], delta: number): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!partIds.length || partIds.some((id) => !isUuid(id)) || (delta !== 1 && delta !== -1)) return { error: "Unknown part." };
  const rows = await db.select().from(parts).where(inArray(parts.id, partIds));
  const itemId = rows.find((p) => p.inventoryItemId)?.inventoryItemId;
  if (!itemId) return { error: "This part isn't linked to an inventory item." };
  const cats = await listCategories();
  await db.transaction((tx) => moveStock(tx, { itemId, delta, reason: delta > 0 ? "received" : "used", partId: rows[0].id }, { memberId: member.id, via: "ui", cats }));
  if (delta > 0) {
    const { usage } = await usageOf([itemId]);
    const covered = usage.get(itemId)?.coveredOf;
    const done = rows.filter(
      (p) => p.inventoryItemId === itemId && p.classification === "cots" && cotsStatusOf(p.designState) !== COTS_IN_STOCK && (covered?.get(p.id) ?? 0) >= Math.max(p.quantity, 1),
    );
    await applyEachPartChanges(done.map((p) => ({ id: p.id, changes: { status: COTS_IN_STOCK } })), { memberId: member.id, via: "ui", receive: false });
  }
  refresh({ cots: true, robots: true });
  return {};
}

// The robot inventory page's button: this robot's COTS parts the shelf can't cover, still in
// Not Started or Released, go to the Order List.
export async function sendShortagesToOrder(robotId: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(robotId)) return { error: "Unknown robot." };
  const items = await robotInventory(robotId);
  const short = items.flatMap((i) => (i.sheet ? [] : i.parts.filter((p) => p.covered < p.quantity && (p.status === COTS_DEFAULT_STATUS || p.status === COTS_RELEASED))));
  if (!short.length) return { message: "Nothing to order: the shelf covers every part or it's already on the Order List." };
  const { changed } = await applyEachPartChanges(
    short.map((p) => ({ id: p.partId, changes: { status: COTS_ORDERED, cotsSentBack: null } })),
    { memberId: member.id, via: "ui" },
  );
  refresh({ cots: true, robots: true });
  return { message: `Sent ${changed} part${changed === 1 ? "" : "s"} to the Order List.` };
}

// "Add to a BOM": the item becomes an ordinary COTS part tied to the item.
export async function addItemToBom(itemId: string, systemId: string, quantity: number): Promise<ActionResult> {
  const member = await requireCapability("manage");
  if (!isUuid(itemId) || !isUuid(systemId)) return { error: "Choose a robot and a system." };
  if (!Number.isInteger(quantity) || quantity < 1) return { error: "Quantity must be at least 1." };
  const [item] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId));
  if (!item) return { error: "Unknown item." };
  await db.insert(schema.parts).values({
    systemId,
    isManual: true,
    displayName: item.name,
    classification: "cots",
    classSource: "manual",
    inventoryItemId: item.id,
    cotsLinks: item.cotsLinks,
    unitPrice: item.price,
    quantity,
    lastModifiedBy: member.id,
  });
  refresh({ cots: true, robots: true });
  return { message: `Added ${quantity} × ${item.name} to the BOM.` };
}

// ---------- Conditions (editable from the toolbar, like FRCBOM); places are edited in Settings → Map ----------

export async function addCondition(label: string, color: string): Promise<ActionResult> {
  await requireCapability("manage");
  label = label.trim();
  if (!label) return { error: "Condition name is required." };
  if (!/^#[0-9a-f]{6}$/i.test(color)) return { error: "Pick a color." };
  await db.insert(inventoryConditions).values({ label, color }).onConflictDoNothing();
  refresh();
  return {};
}

export async function deleteCondition(id: string) {
  await requireCapability("manage");
  if (isUuid(id)) await db.delete(inventoryConditions).where(eq(inventoryConditions.id, id));
  refresh();
}

// ---------- Spreadsheet import ----------

const importRows = z
  .array(
    z.object({
      name: z.string().trim().min(1),
      inStock: z.number().min(0).nullable(),
      location: z.string().trim().nullable(),
      groupPath: z.array(z.string().trim().min(1)),
      condition: z.string().trim().nullable(),
      material: z.string().trim().nullable(),
      seasonNeed: z.number().min(0).nullable(),
      price: z.number().min(0).nullable(),
      url: z.url().nullable(),
      note: z.string().max(2000).nullable(),
    }),
  )
  .max(5000, "Import at most 5000 rows at a time.");

// A row whose name and category match an item already here updates it (stock as a counted move,
// and only the fields the row fills in); every other row is a new item.
export async function importItems(rows: ImportRow[]): Promise<ActionResult> {
  const member = await requireCapability("manage");
  const parsed = importRows.safeParse(rows);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const key = (s: string) => s.toLowerCase();
  const itemKey = (name: string, category: string) => `${category}\u0000${name.toLowerCase().replace(/\s+/g, " ").trim()}`;
  const ctx = { memberId: member.id, via: "ui" as const };

  const cats = await listCategories();
  const isSheet = (category: string | null) => !!getCategory(cats, category)?.sheet;
  const created = await db.transaction(async (tx) => {
    const locations = new Map(
      (await tx.select().from(inventoryLocations)).map((l) => [key(l.name), l.id] as const),
    );
    const conditions = new Map(
      (await tx.select().from(inventoryConditions)).map((c) => [key(c.label), c.id] as const),
    );
    const groups = await tx.select().from(inventoryGroups);
    const existing = new Map(
      (await tx.select().from(inventoryItems)).map((i) => [itemKey(i.name, categoryOf(i, cats)), i] as const),
    );
    const counts = { locations: 0, groups: 0, conditions: 0, added: 0, updated: 0 };

    const locationId = async (name: string | null) => {
      if (!name) return null;
      let id = locations.get(key(name));
      if (!id) {
        [{ id }] = await tx.insert(inventoryLocations).values({ name }).returning({ id: inventoryLocations.id });
        locations.set(key(name), id);
        counts.locations++;
      }
      return id;
    };
    const conditionId = async (label: string | null) => {
      if (!label) return null;
      let id = conditions.get(key(label));
      if (!id) {
        [{ id }] = await tx
          .insert(inventoryConditions)
          .values({ label, color: "#64748b" })
          .returning({ id: inventoryConditions.id });
        conditions.set(key(label), id);
        counts.conditions++;
      }
      return id;
    };
    const groupId = async (path: string[]) => {
      let parentId: string | null = null;
      for (const name of path) {
        let group = groups.find((g) => g.parentId === parentId && key(g.name) === key(name));
        if (!group) {
          [group] = await tx.insert(inventoryGroups).values({ name, parentId }).returning();
          groups.push(group);
          counts.groups++;
        }
        parentId = group.id;
      }
      return parentId;
    };

    for (const row of parsed.data) {
      const category = importCategory(row, cats);
      const sheet = isSheet(category);
      const k = itemKey(row.name, categoryOf({ category, name: row.name }, cats));
      const before = existing.get(k);
      // A category column that only names one of our categories (an exported file) makes no group.
      const path = row.groupPath.length === 1 && cats.some((c) => key(c.label) === key(row.groupPath[0])) ? [] : row.groupPath;
      if (before) {
        const links = row.url && !before.cotsLinks.some((l) => l.url === row.url) ? [{ url: row.url, site: vendorOfUrl(row.url) }, ...before.cotsLinks].slice(0, 10) : null;
        const values = {
          ...(row.location && { locationId: await locationId(row.location) }),
          ...(row.condition && { conditionId: await conditionId(row.condition) }),
          ...(row.material && { specs: { ...before.specs, material: row.material } }),
          ...(row.seasonNeed !== null && { seasonNeed: snapStock(row.seasonNeed, sheet) || null }),
          ...(row.price !== null && { price: row.price }),
          ...(row.note && { note: row.note }),
          ...(links && { cotsLinks: links }),
        };
        if (Object.keys(values).length) {
          await tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, before.id));
          await recordItemChanges(tx, before.id, before, values, ctx);
          await pushItemToCards(tx, before.id, {
            ...(values.cotsLinks && { cotsLinks: values.cotsLinks }),
            ...(values.price !== undefined && values.price !== before.price && { price: values.price }),
          });
        }
        if (row.inStock !== null) await setStock(tx, before.id, snapStock(row.inStock, sheet), ctx);
        counts.updated++;
        continue;
      }
      const values = {
        name: row.name,
        specs: (row.material ? { material: row.material } : {}) as Record<string, string>,
        locationId: await locationId(row.location),
        conditionId: await conditionId(row.condition),
        groupId: await groupId(path),
        category,
        seasonNeed: row.seasonNeed ? snapStock(row.seasonNeed, sheet) || null : null,
        price: row.price,
        note: row.note,
        cotsLinks: row.url ? [{ url: row.url, site: vendorOfUrl(row.url) }] : [],
      };
      // Through createItem, so an imported item has its history line like any other.
      const id = await createItem(tx, values, snapStock(row.inStock ?? 0, sheet), ctx);
      // A later row of the same item in the file updates it.
      const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, id));
      existing.set(k, item);
      counts.added++;
    }
    return counts;
  });

  refresh({ cots: true });
  const extra = [
    created.groups && `${created.groups} groups`,
    created.locations && `${created.locations} locations`,
    created.conditions && `${created.conditions} conditions`,
  ].filter(Boolean);
  const done = [created.added && `added ${created.added} items`, created.updated && `updated ${created.updated} existing items`].filter(Boolean).join(" and ");
  return {
    message: `Imported: ${done || "nothing new"}${extra.length ? `; created ${extra.join(", ")}` : ""}.`,
  };
}

// An imported row's category: a spreadsheet group named like a category, else a guess from the
// group names and the item's name. Left unset when nothing fits, so it keeps being guessed.
function importCategory(row: { name: string; groupPath: string[] }, cats: InvCategory[]) {
  const named = cats.find((c) => row.groupPath.some((g) => g.toLowerCase() === c.label.toLowerCase()));
  return named?.id ?? guessCategory([...row.groupPath, row.name].join(" "), cats.map((c) => c.id));
}

// The item page's Possible matches: link COTS parts to this item.
export async function linkPartsToItem(itemId: string, partIds: string[]): Promise<ActionResult> {
  const member = await requireCapability("manage");
  if (!isUuid(itemId) || !partIds.length || partIds.some((id) => !isUuid(id))) return { error: "Unknown part." };
  const { changed } = await applyEachPartChanges(partIds.map((id) => ({ id, changes: { inventoryItemId: itemId } })), { memberId: member.id, via: "ui" });
  refresh({ cots: true, robots: true });
  return { message: `Linked ${changed} part${changed === 1 ? "" : "s"}.` };
}

// ---------- Category settings (on the Settings page) ----------

const fieldSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1, "A field needs a name.").max(60),
  kind: z.enum(["number", "text", "options", "material"]),
  options: z.array(z.string().trim().min(1).max(60)).max(100).optional(),
  list: z.literal("bores").optional(),
  ownOptions: z.array(z.string().trim().min(1).max(60)).max(100).optional(),
  materials: z.array(z.string()).max(20).optional(),
  name: z.string().max(40).optional(),
  hidden: z.boolean().optional(),
  when: z.union([z.string().max(60), z.array(z.string().max(60)).max(20)]).optional(),
});
const categorySchema = z.object({
  id: z.string(),
  label: z.string().trim().min(1, "A category needs a name.").max(60),
  noun: z.string().trim().max(40),
  sheet: z.boolean(),
  group: z.string().refine(isCategoryGroup, "Unknown group."),
  defaultLocationId: z.string().nullable().refine((v) => v === null || isUuid(v), "Unknown location."),
  fields: z.array(fieldSchema).max(20),
});

// Saves a category as edited in place. Field ids are kept, so values already on items stay theirs.
export async function saveCategory(cat: InvCategory): Promise<ActionResult> {
  await requireCapability("manage");
  const parsed = categorySchema.safeParse(cat);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { id, ...values } = parsed.data;
  const ids = values.fields.map((f) => f.id);
  if (new Set(ids).size !== ids.length) return { error: "Two fields have the same id." };
  // Fields on the global Bore list keep only their own extras; the list is merged in on read.
  const bores = values.fields.some((f) => f.list) ? (await listBores()).map((b) => b.name) : [];
  values.fields = values.fields.map((f) => storedBoreField(f, bores));
  await db.update(inventoryCategories).set(values).where(eq(inventoryCategories.id, id));
  refresh();
  return {};
}

export async function addCategory(label: string): Promise<ActionResult & { id?: string }> {
  await requireCapability("manage");
  label = label.trim();
  if (!label) return { error: "A category needs a name." };
  const cats = await listCategories();
  let id = slugify(label);
  for (let n = 2; cats.some((c) => c.id === id); n++) id = `${slugify(label)}-${n}`;
  await db.insert(inventoryCategories).values({ id, label, noun: label.replace(/s$/i, ""), position: cats.length });
  refresh();
  return { id };
}

// A category with items can't go; its items would lose their fields.
export async function deleteCategory(id: string): Promise<ActionResult> {
  await requireCapability("manage");
  const { items } = await listInventory();
  const n = items.filter((i) => i.category === id).length;
  if (n) return { error: `${n} item${n === 1 ? " is" : "s are"} in this category. Move ${n === 1 ? "it" : "them"} first.` };
  await db.delete(inventoryCategories).where(eq(inventoryCategories.id, id));
  refresh();
  return {};
}

export async function moveCategory(id: string, by: -1 | 1): Promise<ActionResult> {
  await requireCapability("manage");
  const cats = await listCategories();
  const from = cats.findIndex((c) => c.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= cats.length) return {};
  const order = [...cats];
  [order[from], order[to]] = [order[to], order[from]];
  await db.transaction(async (tx) => {
    for (const [i, c] of order.entries()) await tx.update(inventoryCategories).set({ position: i }).where(eq(inventoryCategories.id, c.id));
  });
  refresh();
  return {};
}

// ---------- Products and popups ----------

// A pasted product link, read from the page's product tags.
export async function readProductLink(url: string) {
  await requireMember();
  try {
    const p = await readProduct(url);
    return { product: { ...p, price: toUsd(p.price, p.currency) } };
  } catch (e) {
    return { error: `Couldn't read that page: ${(e as Error).message || "no answer"} You can still fill it in.` };
  }
}

// The closable window anything inventory opens (an item, or a material's stock). An item's
// history loads only when its History section is opened (loadItemHistory).
export async function itemPopup(itemId: string) {
  await requireMember();
  if (!isUuid(itemId)) return null;
  const [detail, targets] = await Promise.all([inventoryItemWithLists(itemId), listBomTargets()]);
  if (!detail) return null;
  const [devices, panorama] = detail.item.station ? await Promise.all([itemDevices(itemId), stationPanorama(detail.item.station)]) : [null, null];
  const order = detail.item.openOrder ? await openOrderPart(detail.item.openOrder.partId) : null;
  // Ordering shows the amount to order (orderAmount in lib/cots.ts): typed on the order pages, else
  // for a card Inventory sent what the item misses now, so it follows Needed for season.
  return { ...detail, targets, devices, panorama, order: order && { ...order, quantity: order.orderQty ?? (order.restock ? missing(detail.item, "any") : order.quantity) } };
}

// The COTS card on its way for an item, for the window's Need to Order box and order status.
async function openOrderPart(partId: string) {
  const [p] = await db
    .select({
      id: schema.parts.id,
      quantity: schema.parts.quantity,
      designState: schema.parts.designState,
      cotsLinks: schema.parts.cotsLinks,
      unitPrice: schema.parts.unitPrice,
      cotsSentBack: schema.parts.cotsSentBack,
      cotsDeliveryDate: schema.parts.cotsDeliveryDate,
      systemId: schema.parts.systemId,
      restock: schema.parts.restock,
      orderQty: schema.parts.orderQty,
    })
    .from(schema.parts)
    .where(eq(schema.parts.id, partId));
  return p ? { id: p.id, quantity: p.quantity, restock: p.restock, orderQty: p.orderQty, status: cotsStatusOf(p.designState), links: p.cotsLinks, unitPrice: p.unitPrice, sentBack: p.cotsSentBack, deliveryDate: p.cotsDeliveryDate, fromBom: p.systemId !== null } : null;
}

export async function loadItemHistory(itemId: string) {
  await requireMember();
  if (!isUuid(itemId)) return { history: [], orders: [] };
  const [{ history }, orders] = await Promise.all([itemHistory(itemId), itemOrderHistory(itemId)]);
  return { history, orders };
}

export async function materialPopup(material: string) {
  await requireMember();
  const { items, categories, locations, conditions } = await listInventory();
  const key = material.trim().toLowerCase();
  return { material, categories, locations, conditions, items: items.filter((i) => i.specs.material?.toLowerCase() === key || i.name.toLowerCase() === key) };
}

// The inventory search in a part's details window: everything the Inventory page's box needs.
export async function inventoryPicker() {
  await requireMember();
  const { items, categories, locations, conditions } = await listInventory();
  return { items, categories, locations, conditions };
}

// The drawing editor's Fit picker (and its clickable notes): every item's name and picture.
export async function fitTargets() {
  await requireMember();
  return listFitTargets();
}
