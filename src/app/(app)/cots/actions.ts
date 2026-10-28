"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { COTS_RELEASED } from "@/config/cots";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { partChangesCapability } from "@/components/shell/mode";
import { requireCapability } from "@/lib/mode";
import { applyEachPartChanges } from "@/lib/parts/apply";
import { partChangesSchema, type PartChanges } from "@/lib/parts/changes";
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
  for (const e of parsed) await requireCapability(partChangesCapability(e.changes));
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
