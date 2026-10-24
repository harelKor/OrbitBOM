import "server-only";
import { and, eq, inArray, not } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CotsLink } from "@/db/schema";
import { recordItemChanges } from "./history";
import type { MoveCtx } from "./moves";

const { parts, inventoryItems } = schema;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Part = typeof parts.$inferSelect;
export type ProductValues = { name?: string; cotsLinks?: CotsLink[]; price?: number | null };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// A COTS card and its inventory item show the same product: the product links and price on every
// linked COTS part, and the name on the cards made from the item (manual parts; an Onshape part
// keeps its CAD name). These copy an edit of one to the others, without history rows on the cards.
export async function pushItemToCards(tx: Tx, itemId: string, v: ProductValues, except: string[] = []) {
  const linked = and(eq(parts.inventoryItemId, itemId), eq(parts.classification, "cots"), except.length ? not(inArray(parts.id, except)) : undefined);
  const product = { ...(v.cotsLinks !== undefined && { cotsLinks: v.cotsLinks }), ...(v.price !== undefined && { unitPrice: v.price }) };
  if (Object.keys(product).length) await tx.update(parts).set(product).where(linked);
  if (v.name) await tx.update(parts).set({ displayName: v.name }).where(and(linked, eq(parts.isManual, true)));
}

// A linked COTS card was edited: its item takes the new name, links or price, and so do the
// item's other cards.
export async function pushCardToItem(tx: Tx, before: Part, after: Part, ctx: MoveCtx) {
  if (after.classification !== "cots" || !after.inventoryItemId || after.inventoryItemId !== before.inventoryItemId) return;
  const v: ProductValues = {
    ...(after.displayName && !same(before.displayName, after.displayName) && { name: after.displayName }),
    ...(!same(before.cotsLinks, after.cotsLinks) && { cotsLinks: after.cotsLinks }),
    ...(!same(before.unitPrice, after.unitPrice) && { price: after.unitPrice }),
  };
  if (!Object.keys(v).length) return;
  const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, after.inventoryItemId)).for("update");
  if (!item) return;
  await tx.update(inventoryItems).set(v).where(eq(inventoryItems.id, item.id));
  await recordItemChanges(tx, item.id, item, v, ctx);
  await pushItemToCards(tx, item.id, v, [after.id]);
}

// A card was just linked to an item: it takes the item's links and price when it has none.
export async function fillCardFromItem(tx: Tx, part: Part, itemId: string) {
  const [item] = await tx.select({ cotsLinks: inventoryItems.cotsLinks, price: inventoryItems.price }).from(inventoryItems).where(eq(inventoryItems.id, itemId));
  if (!item || part.classification !== "cots") return;
  const set = {
    ...(!part.cotsLinks.length && item.cotsLinks.length && { cotsLinks: item.cotsLinks }),
    ...(part.unitPrice == null && item.price != null && { unitPrice: item.price }),
  };
  if (Object.keys(set).length) await tx.update(parts).set(set).where(eq(parts.id, part.id));
}
