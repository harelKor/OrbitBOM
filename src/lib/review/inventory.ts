import "server-only";
import { randomUUID } from "node:crypto";
import { count, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CategoryField } from "@/db/schema";
import { listCategories } from "@/lib/data/categories";
import { categoryOf, getCategory, specLine, type InvCategory } from "@/lib/inventory/categories";
import { pushItemToCards } from "@/lib/inventory/cotsSync";
import { ITEM_FIELDS, recordItemChanges } from "@/lib/inventory/history";
import type { MoveCtx } from "@/lib/inventory/moves";

const { inventoryItems, inventoryReviews, inventoryCategories, inventoryLocations, members } = schema;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Item = typeof inventoryItems.$inferSelect;
export type ItemField = (typeof ITEM_FIELDS)[number];
export type ItemEdit = Partial<Pick<Item, "name" | "category" | "specs" | "cotsLinks" | "price" | "seasonNeed" | "locationId">>;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// An item's product values changed: its COTS cards follow (like an edit in the item window).
async function pushProduct(tx: Tx, itemId: string, values: Record<string, unknown>) {
  if (!("name" in values) && !("cotsLinks" in values) && !("price" in values)) return;
  await pushItemToCards(tx, itemId, {
    name: values.name as string | undefined,
    cotsLinks: values.cotsLinks as Item["cotsLinks"] | undefined,
    price: values.price as number | null | undefined,
  });
}

// A Claude edit to existing items: applied at once and recorded in the item history under the
// batch, and each changed item waits in To Review. An item already waiting keeps its first
// "before" values, so Reject still puts back what was there before any AI touched it.
export async function applyItemEdits(
  edits: { itemId: string; values: ItemEdit; reason?: string | null }[],
  ctx: { memberId: string; aiName: string | null; batchId: string },
) {
  let changed = 0;
  await db.transaction(async (tx) => {
    for (const e of edits) {
      const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, e.itemId)).for("update");
      if (!item) continue;
      const current = item as unknown as Record<string, unknown>;
      const values = Object.fromEntries(Object.entries(e.values).filter(([f, v]) => !same(current[f], v)));
      if (!Object.keys(values).length) continue;
      changed++;
      await tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, item.id));
      await recordItemChanges(tx, item.id, current, values, { memberId: ctx.memberId, via: "mcp", aiName: ctx.aiName, batchId: ctx.batchId });
      await pushProduct(tx, item.id, values);

      const [existing] = await tx.select().from(inventoryReviews).where(eq(inventoryReviews.itemId, item.id)).for("update");
      const changes = { ...(existing?.changes ?? {}) };
      for (const [f, to] of Object.entries(values)) {
        const from = f in changes ? changes[f].from : (current[f] ?? null);
        if (same(from, to)) delete changes[f];
        else changes[f] = { from, to };
      }
      const row = { changes, reason: e.reason ?? existing?.reason ?? null, memberId: ctx.memberId, batchId: ctx.batchId, aiName: ctx.aiName, createdAt: new Date() };
      if (!Object.keys(changes).length) {
        if (existing) await tx.delete(inventoryReviews).where(eq(inventoryReviews.id, existing.id));
      } else if (existing) await tx.update(inventoryReviews).set(row).where(eq(inventoryReviews.id, existing.id));
      else await tx.insert(inventoryReviews).values({ kind: "item", itemId: item.id, ...row });
    }
  });
  return changed;
}

// A category a member's Claude added: it exists at once (items can go in it) and waits in To
// Review, where Reject removes it again.
export async function addCategoryForReview(
  cat: { id: string; label: string; noun: string; group: string; sheet: boolean; fields: CategoryField[] },
  ctx: { memberId: string; aiName: string | null; batchId: string; reason?: string | null },
) {
  await db.transaction(async (tx) => {
    const cats = await listCategories(tx);
    await tx.insert(inventoryCategories).values({ ...cat, position: cats.length, batchId: ctx.batchId });
    await tx.insert(inventoryReviews).values({ kind: "category", categoryId: cat.id, memberId: ctx.memberId, aiName: ctx.aiName, batchId: ctx.batchId, reason: ctx.reason ?? null });
  });
}

// ---------- To Review ----------

export type InventoryReviewChange = { field: string; label: string; from: string | null; to: string | null };
export type InventoryReview = {
  id: string;
  kind: "item" | "category";
  itemId: string | null; // the item a change is on (null for a new category)
  name: string;
  categoryId: string;
  categoryLabel: string;
  changes: InventoryReviewChange[];
  reason: string | null;
  aiName: string | null;
  memberName: string | null;
  batchId: string | null;
  at: string;
};

const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  category: "Category",
  specs: "Specs",
  locationId: "Location",
  conditionId: "Condition",
  cotsLinks: "Links",
  price: "Price",
  imagePath: "Photo",
  seasonNeed: "Season need",
};

// How an item field's value reads on To Review and AI logs.
export function itemValueText(
  field: string,
  v: unknown,
  ctx: { cats: InvCategory[]; locations: Map<string, string>; category?: string | null },
): string | null {
  if (v == null || v === "") return null;
  if (field === "category") return getCategory(ctx.cats, v as string)?.label ?? String(v);
  if (field === "locationId") return ctx.locations.get(v as string) ?? "removed location";
  if (field === "specs") return specLine(getCategory(ctx.cats, ctx.category), v as Record<string, string>) || null;
  if (field === "cotsLinks") return Array.isArray(v) && v.length ? `${v.length} ${v.length === 1 ? "link" : "links"}` : null;
  if (field === "price") return `$${v}`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
export const itemFieldLabel = (field: string) => FIELD_LABELS[field] ?? field;

export async function locationNames() {
  return new Map((await db.select({ id: inventoryLocations.id, name: inventoryLocations.name }).from(inventoryLocations)).map((l) => [l.id, l.name]));
}

// Everything waiting in To Review's Inventory section, newest first. Inventory is one shelf for
// every robot, so each robot's To Review shows the same list.
export async function listInventoryReviews(): Promise<InventoryReview[]> {
  const rows = await db
    .select({ review: inventoryReviews, item: inventoryItems, memberName: members.name })
    .from(inventoryReviews)
    .leftJoin(inventoryItems, eq(inventoryItems.id, inventoryReviews.itemId))
    .leftJoin(members, eq(members.id, inventoryReviews.memberId))
    .orderBy(desc(inventoryReviews.createdAt));
  if (!rows.length) return [];
  const [cats, locations] = await Promise.all([listCategories(), locationNames()]);
  return rows.flatMap(({ review, item, memberName }): InventoryReview[] => {
    const base = { id: review.id, reason: review.reason, aiName: review.aiName, memberName, batchId: review.batchId, at: review.createdAt.toISOString() };
    if (review.kind === "category") {
      const cat = getCategory(cats, review.categoryId);
      if (!cat) return [];
      const fields = cat.fields.filter((f) => !f.hidden).map((f) => f.label);
      return [
        {
          ...base,
          kind: "category" as const,
          itemId: null,
          name: cat.label,
          categoryId: cat.id,
          categoryLabel: cat.label,
          changes: [{ field: "fields", label: "New category", from: null, to: fields.length ? fields.join(", ") : "no fields" }],
        },
      ];
    }
    if (!item) return [];
    const category = categoryOf(item, cats);
    const changes = Object.entries(review.changes).map(([field, c]) => {
      // Specs read in the category they were written for.
      const ctx = { cats, locations, category: field === "specs" ? category : null };
      return { field, label: itemFieldLabel(field), from: itemValueText(field, c.from, ctx), to: itemValueText(field, c.to, ctx) };
    });
    return [{ ...base, kind: "item" as const, itemId: item.id, name: item.name, categoryId: category, categoryLabel: getCategory(cats, category)?.label ?? "Other", changes }];
  });
}

export async function countInventoryReviews() {
  const [row] = await db.select({ n: count() }).from(inventoryReviews);
  return row?.n ?? 0;
}

// Approve keeps the change (it is already applied) and takes it off To Review.
export async function approveInventoryReviews(ids: string[]) {
  if (!ids.length) return 0;
  const rows = await db.delete(inventoryReviews).where(inArray(inventoryReviews.id, ids)).returning({ id: inventoryReviews.id });
  return rows.length;
}

// Puts an item's fields back where they still hold the AI's value (a field someone edited
// since is kept), recorded as a new edit. Returns how many fields were kept as edited.
async function restoreItem(tx: Tx, itemId: string, changes: Record<string, { from: unknown; to: unknown }>, ctx: MoveCtx) {
  const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).for("update");
  if (!item) return 0;
  const current = item as unknown as Record<string, unknown>;
  let kept = 0;
  const back: Record<string, unknown> = {};
  for (const [f, c] of Object.entries(changes)) {
    if (!(ITEM_FIELDS as readonly string[]).includes(f)) continue;
    if (!same(current[f], c.to)) {
      kept++;
      continue;
    }
    back[f] = f === "name" ? (c.from ?? item.name) : f === "specs" ? (c.from ?? {}) : f === "cotsLinks" ? (c.from ?? []) : (c.from ?? null);
  }
  // A location or category deleted since can't be put back.
  if (typeof back.locationId === "string") {
    const [loc] = await tx.select({ id: inventoryLocations.id }).from(inventoryLocations).where(eq(inventoryLocations.id, back.locationId));
    if (!loc) back.locationId = null;
  }
  if (Object.keys(back).length) {
    await tx.update(inventoryItems).set(back).where(eq(inventoryItems.id, itemId));
    await recordItemChanges(tx, itemId, current, back, ctx);
    await pushProduct(tx, itemId, back);
  }
  return kept;
}

// Removes a category; its items go back to having none (their category is guessed again).
async function removeCategory(tx: Tx, categoryId: string, ctx: MoveCtx) {
  const inIt = await tx.select({ id: inventoryItems.id }).from(inventoryItems).where(eq(inventoryItems.category, categoryId));
  for (const { id } of inIt) {
    await tx.update(inventoryItems).set({ category: null }).where(eq(inventoryItems.id, id));
    await recordItemChanges(tx, id, { category: categoryId }, { category: null }, ctx);
  }
  await tx.delete(inventoryCategories).where(eq(inventoryCategories.id, categoryId));
}

// The card's X: off To Review as it is now. An item edit or new category is already applied, so
// this keeps it, like Approve, without counting as one.
export const dismissInventoryReviews = approveInventoryReviews;

// Reject puts an item's old values back, or removes a new category, and takes it off To Review.
export async function rejectInventoryReviews(ids: string[], memberId: string) {
  if (!ids.length) return { rejected: 0, keptEdits: 0 };
  const ctx: MoveCtx = { memberId, via: "ui", batchId: randomUUID() };
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(inventoryReviews).where(inArray(inventoryReviews.id, ids)).for("update");
    let keptEdits = 0;
    for (const r of rows) {
      if (r.kind === "item" && r.itemId) keptEdits += await restoreItem(tx, r.itemId, r.changes, ctx);
      if (r.kind === "category" && r.categoryId) await removeCategory(tx, r.categoryId, ctx);
    }
    if (rows.length) await tx.delete(inventoryReviews).where(inArray(inventoryReviews.id, rows.map((r) => r.id)));
    return { rejected: rows.length, keptEdits };
  });
}

// ---------- Revert (AI logs) ----------

// Reverses a batch's inventory changes, other than stock: items it created are deleted, fields it
// edited go back (unless edited since), categories it added are removed, and its To Review
// entries go. Returns what it did.
export async function revertInventoryBatch(tx: Tx, batchId: string, ctx: MoveCtx) {
  const history = await tx
    .select()
    .from(schema.inventoryItemHistory)
    .where(eq(schema.inventoryItemHistory.batchId, batchId))
    .orderBy(schema.inventoryItemHistory.at);
  const created = [...new Set(history.filter((h) => h.field === "created").map((h) => h.itemId))];
  if (created.length) await tx.delete(inventoryItems).where(inArray(inventoryItems.id, created));

  // A field edited several times in the batch goes back to its value before the first edit.
  const span = new Map<string, { itemId: string; field: string; from: unknown; to: unknown }>();
  for (const h of history) {
    if (h.field === "created" || created.includes(h.itemId)) continue;
    const k = `${h.itemId}|${h.field}`;
    const s = span.get(k);
    span.set(k, { itemId: h.itemId, field: h.field, from: s ? s.from : h.oldValue, to: h.newValue });
  }
  let kept = 0;
  let edited = 0;
  const byItem = new Map<string, Record<string, { from: unknown; to: unknown }>>();
  for (const s of span.values()) byItem.set(s.itemId, { ...(byItem.get(s.itemId) ?? {}), [s.field]: { from: s.from, to: s.to } });
  for (const [itemId, changes] of byItem) {
    const k = await restoreItem(tx, itemId, changes, ctx);
    kept += k;
    edited += Object.keys(changes).length - k;
  }

  const cats = await tx.select({ id: inventoryCategories.id }).from(inventoryCategories).where(eq(inventoryCategories.batchId, batchId));
  for (const c of cats) await removeCategory(tx, c.id, ctx);

  // Items whose review was only this batch's edits are off To Review now.
  await tx.delete(inventoryReviews).where(eq(inventoryReviews.batchId, batchId));
  return { created: created.length, edited, kept, categories: cats.length };
}
