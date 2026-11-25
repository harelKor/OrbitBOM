"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { COTS_RELEASED } from "@/config/cots";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { partChangesCapability } from "@/components/shell/mode";
import { checkCapability, requireCapability, statusChangeDenied } from "@/lib/mode";
import { applyEachPartChanges } from "@/lib/parts/apply";
import { partChangesSchema, type PartChanges } from "@/lib/parts/changes";
import { MERGE_ITEMS_DIFFER, sameItemForMerge, siteOf } from "@/lib/cots";
import { deleteToTrash } from "@/lib/trash";
import { isUuid } from "@/lib/uuid";
import type { ActionResult } from "../parts-actions";

// The COTS page's edits: a card that stands for the same part in several systems changes each of
// them (its stock count spread over them), all in one history batch.
export async function updateCotsParts(edits: { id: string; changes: unknown }[]): Promise<ActionResult> {
  const member = await requireMember();
  if (!edits.length || edits.some((e) => !isUuid(e.id))) return { error: "Unknown part." };
  const parsed: { id: string; changes: PartChanges }[] = [];
  for (const e of edits) {
    const r = partChangesSchema.safeParse(e.changes);
    if (!r.success) return { error: r.error.issues[0].message };
    parsed.push({ id: e.id, changes: r.data });
  }
  for (const e of parsed) {
    const { error } = await checkCapability(partChangesCapability(e.changes));
    if (error !== undefined) return { error };
    const denied = await statusChangeDenied([e.id], e.changes);
    if (denied) return { error: denied };
  }
  await applyEachPartChanges(parsed, { memberId: member.id, via: "ui" });
  revalidatePath("/cots", "layout");
  revalidatePath("/robots", "layout");
  return {};
}

// The search box on Released: an inventory item becomes a COTS card linked to it, in a robot's
// section (no system) or in General (no robot), ready to be ordered.
export async function addCotsFromItem(itemId: string, robotId: string | null): Promise<ActionResult> {
  const member = await requireCapability("manage");
  if (!isUuid(itemId) || (robotId !== null && !isUuid(robotId))) return { error: "Unknown item." };
  const [item] = await db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, itemId));
  if (!item) return { error: "That item was deleted." };
  if (robotId) {
    const [robot] = await db.select({ id: schema.robots.id }).from(schema.robots).where(eq(schema.robots.id, robotId));
    if (!robot) return { error: "Unknown robot." };
  }
  await db.insert(schema.parts).values({
    systemId: null,
    robotId,
    isManual: true,
    displayName: item.name,
    classification: "cots",
    classSource: "manual",
    inventoryItemId: item.id,
    cotsLinks: item.cotsLinks,
    unitPrice: item.price,
    quantity: 1,
    designState: COTS_RELEASED,
    stageAt: new Date(), // arrives in COTS Released (src/lib/seen.ts)
    lastModifiedBy: member.id,
  });
  revalidatePath("/cots", "layout");
  revalidatePath("/inventory");
  return { message: `Added ${item.name} to Released.` };
}

// The X on a card in an In Stock section: it leaves those sections (the part itself stays).
export async function clearInStock(ids: string[]): Promise<ActionResult> {
  await requireCapability("work");
  if (!ids.length || ids.some((id) => !isUuid(id))) return { error: "Unknown part." };
  await db.update(schema.parts).set({ cotsClearedAt: new Date() }).where(inArray(schema.parts.id, ids));
  revalidatePath("/cots", "layout");
  return {};
}

// The ✕ on an Order History card: it leaves the Order History page and the item's Past orders.
export async function dismissOrderHistory(id: string): Promise<ActionResult> {
  await requireCapability("work");
  if (!isUuid(id)) return { error: "Unknown order." };
  await db.update(schema.cotsOrderHistory).set({ dismissedAt: new Date() }).where(eq(schema.cotsOrderHistory.id, id));
  revalidatePath("/cots", "layout");
  revalidatePath("/inventory");
  return {};
}

// The "-" on an Order History card whose In Route or arrival date was never recorded: typed text
// shows in its place. Empty text puts the "-" back.
export async function setOrderHistoryDateText(id: string, side: "inRoute" | "arrived", text: string): Promise<ActionResult> {
  await requireCapability("work");
  if (!isUuid(id) || (side !== "inRoute" && side !== "arrived") || typeof text !== "string") return { error: "Unknown order." };
  const value = text.trim().slice(0, 40) || null;
  const h = schema.cotsOrderHistory;
  await db
    .update(h)
    .set(side === "inRoute" ? { inRouteText: value } : { arrivedText: value })
    .where(eq(h.id, id));
  revalidatePath("/cots", "layout");
  revalidatePath("/inventory");
  return {};
}

// The Order List's 🛒 Cart: the picked parts become a cart, or join one. A cart is one vendor's
// parts (by their first product link), or parts with no link at all under a name the member gives
// it ("Plates – mentor's supplier", Harel 2026-11-24), which gets Copy list instead of the vendor's
// site. A part already in another cart moves.
export async function saveCotsCart(cartId: string | null, partIds: string[], name?: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!partIds.length || partIds.some((id) => !isUuid(id)) || (cartId !== null && !isUuid(cartId))) return { error: "Unknown part." };
  const rows = await db
    .select({ id: schema.parts.id, links: schema.parts.cotsLinks })
    .from(schema.parts)
    .where(and(inArray(schema.parts.id, partIds), eq(schema.parts.classification, "cots")));
  if (rows.length !== new Set(partIds).size) return { error: "Unknown part." };
  // "" stands for no product link.
  const vendors = new Set(rows.map((p) => (p.links[0] ? siteOf(p.links[0]) : "")));
  if (vendors.size !== 1) return { error: vendors.has("") ? "A cart takes parts with a product link or parts without one, not both." : "A cart's parts all come from one vendor." };
  const [vendor] = vendors as Set<string>;
  const title = (name ?? "").trim().slice(0, 120) || null;
  if (!vendor && !cartId && !title) return { error: "Give the cart a name, like \"Plates – mentor's supplier\"." };
  const ids = rows.map((p) => p.id);
  const message = await db.transaction(async (tx) => {
    let id = cartId;
    if (id) {
      const [cart] = await tx.select().from(schema.cotsCarts).where(eq(schema.cotsCarts.id, id));
      if (!cart) return "That cart was deleted.";
      if (cart.vendor !== vendor) return cart.vendor ? `That cart is for ${cart.vendor}.` : "That cart is for parts with no product link.";
    } else {
      [{ id }] = await tx.insert(schema.cotsCarts).values({ vendor, name: vendor ? null : title, createdBy: member.id }).returning({ id: schema.cotsCarts.id });
    }
    await tx.delete(schema.cotsCartMembers).where(inArray(schema.cotsCartMembers.partId, ids));
    await tx.insert(schema.cotsCartMembers).values(ids.map((partId) => ({ cartId: id!, partId })));
    return null;
  });
  if (message) return { error: message };
  revalidatePath("/cots", "layout");
  return {};
}

// "Remove from orders" on an inventory item's card (one Inventory sent to orders): the card leaves
// the order pages; the item and its stock stay as they are. Kept in Recently deleted for 30 days.
export async function removeFromOrders(partId: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  if (!isUuid(partId)) return { error: "Unknown item." };
  const where = and(eq(schema.parts.id, partId), eq(schema.parts.restock, true), eq(schema.parts.isManual, true))!;
  const [card] = await db.select({ name: schema.parts.displayName }).from(schema.parts).where(where);
  if (!card) return { error: "Only an item Inventory sent to orders can be removed here." };
  const label = `${card.name ?? "Item"} (order)`;
  await db.transaction((tx) => deleteToTrash(tx, { kind: "part", label, root: schema.parts, where, memberId: member.id }));
  revalidatePath("/cots", "layout");
  revalidatePath("/inventory");
  return { message: `Removed ${card.name ?? "the item"} from orders.` };
}

// A cart's "Remove from cart" (one part) and "Delete cart": the parts stay on the Order List.
export async function removeFromCotsCart(cartId: string, partIds: string[]): Promise<ActionResult> {
  await requireCapability("work");
  if (!isUuid(cartId) || partIds.some((id) => !isUuid(id))) return { error: "Unknown cart." };
  await db.delete(schema.cotsCartMembers).where(and(eq(schema.cotsCartMembers.cartId, cartId), inArray(schema.cotsCartMembers.partId, partIds)));
  revalidatePath("/cots", "layout");
  return {};
}

export async function deleteCotsCart(cartId: string): Promise<ActionResult> {
  await requireCapability("work");
  if (!isUuid(cartId)) return { error: "Unknown cart." };
  await db.delete(schema.cotsCarts).where(eq(schema.cotsCarts.id, cartId));
  revalidatePath("/cots", "layout");
  return {};
}

// Released's Merge (Harel, 2026-11-20): several parts become one order line on the order pages
// (tubes cut to several lengths in the BOM, bought as one stock), under one name. Parts linked to
// different inventory items aren't merged: their shelves count apart.
export async function mergeOrderRows(partIds: string[], name: string): Promise<ActionResult> {
  const member = await requireCapability("work");
  const ids = [...new Set(partIds)];
  const title = name.trim().slice(0, 200);
  if (ids.length < 2 || ids.some((id) => !isUuid(id))) return { error: "Pick at least two parts to merge." };
  if (!title) return { error: "Give the merged order a name." };
  const rows = await db.select({ id: schema.parts.id, inventoryItemId: schema.parts.inventoryItemId }).from(schema.parts).where(inArray(schema.parts.id, ids));
  if (rows.length !== ids.length) return { error: "Unknown part." };
  if (!sameItemForMerge(rows)) return { error: MERGE_ITEMS_DIFFER };
  // Merging a merged line with more parts makes one new line of them all.
  const mergeId = randomUUID();
  await applyEachPartChanges(
    ids.map((id) => ({ id, changes: { orderMerge: mergeId, orderName: title } })),
    { memberId: member.id, via: "ui" },
  );
  revalidatePath("/cots", "layout");
  return {};
}

// Unmerge: each part is its own order line again, under its own name.
export async function unmergeOrderRows(partIds: string[]): Promise<ActionResult> {
  const member = await requireCapability("work");
  const ids = [...new Set(partIds)];
  if (!ids.length || ids.some((id) => !isUuid(id))) return { error: "Unknown part." };
  await applyEachPartChanges(
    ids.map((id) => ({ id, changes: { orderMerge: null, orderName: null } })),
    { memberId: member.id, via: "ui" },
  );
  revalidatePath("/cots", "layout");
  return {};
}
