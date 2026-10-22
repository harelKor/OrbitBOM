"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { COTS_DEFAULT_STATUS, COTS_IN_STOCK, COTS_ORDERED, COTS_RELEASED, cotsStatusOf } from "@/config/cots";
import { getPartType, isSheetType } from "@/config/partTypes";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { robotInventory, usageOf } from "@/lib/data/inventory";
import type { ImportRow } from "@/lib/inventory/import";
import { moveStock, setStock } from "@/lib/inventory/moves";
import { parseStock } from "@/lib/inventory/stock";
import { applyEachPartChanges } from "@/lib/parts/apply";
import { isUuid } from "@/lib/uuid";

const { inventoryItems, inventoryGroups, inventoryConditions, inventoryLocations, inventoryMoves, parts } = schema;

export type ActionResult = { error?: string; message?: string };

const refresh = () => {
  revalidatePath("/inventory");
  revalidatePath("/robots", "layout");
  revalidatePath("/cots", "layout");
};

const text = z
  .string()
  .trim()
  .transform((v) => v || null);
const ref = z
  .string()
  .transform((v) => v || null)
  .refine((v) => v === null || isUuid(v), "Unknown option.");

const itemForm = z.object({
  name: z.string().trim().min(1, "Part name is required."),
  inStock: z.string().default("0"),
  conditionId: ref,
  groupId: ref,
  locationId: ref,
  templateId: text.refine((v) => v === null || !!getPartType(v), "Unknown part type."),
  material: text,
  vendorUrl: z.union([z.literal(""), z.url("The vendor link must be a URL.")]).transform((v) => v || null),
  vendorName: text,
  price: z.union([z.literal(""), z.coerce.number().min(0)]).transform((v) => (v === "" ? null : v)),
});

// Add or edit an item. Part-type detail fields arrive as "tv.<fieldId>".
export async function saveItem(
  itemId: string | null,
  _: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const member = await requireMember();
  const parsed = itemForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const type = parsed.data.templateId ? getPartType(parsed.data.templateId) : undefined;
  const templateValues: Record<string, string> = {};
  for (const field of type?.fields ?? []) {
    const v = String(formData.get(`tv.${field.id}`) ?? "").trim();
    if (v) templateValues[field.id] = v;
  }
  // Sheets take pieces ("2 3/4"); everything else whole units. The stock changes as a counted move.
  const { inStock: stockText, ...rest } = parsed.data;
  const inStock = parseStock(stockText, isSheetType(rest.templateId));
  if (inStock === null) return { error: isSheetType(rest.templateId) ? 'In stock is sheets, like "2" or "1 3/4".' : "In stock is a whole number." };
  const values = { ...rest, templateValues };
  if (itemId && !isUuid(itemId)) return { error: "Unknown item." };
  await db.transaction(async (tx) => {
    let id = itemId;
    if (id) await tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, id));
    else [{ id }] = await tx.insert(inventoryItems).values(values).returning({ id: inventoryItems.id });
    await setStock(tx, id!, inStock, { memberId: member.id, via: "ui" });
  });
  refresh();
  return {};
}

export async function deleteItem(itemId: string) {
  await requireMember();
  if (!isUuid(itemId)) return;
  await db.delete(inventoryItems).where(eq(inventoryItems.id, itemId));
  refresh();
}

// The − / + stepper (a sheet item also steps by pieces of a sheet).
export async function adjustStock(itemId: string, delta: number): Promise<ActionResult> {
  const member = await requireMember();
  if (!isUuid(itemId) || !Number.isFinite(delta) || !delta) return { error: "Unknown item." };
  await db.transaction((tx) => moveStock(tx, { itemId, delta, reason: delta > 0 ? "received" : "used" }, { memberId: member.id, via: "ui" }));
  refresh();
  return {};
}

// A linked COTS card's − / +: the units go on or come off its item's shelf. Like the card's own
// count, reaching the quantity sets the part In Stock (parts the new unit now fully covers).
export async function stepShelfStock(partIds: string[], delta: number): Promise<ActionResult> {
  const member = await requireMember();
  if (!partIds.length || partIds.some((id) => !isUuid(id)) || (delta !== 1 && delta !== -1)) return { error: "Unknown part." };
  const rows = await db.select().from(parts).where(inArray(parts.id, partIds));
  const itemId = rows.find((p) => p.inventoryItemId)?.inventoryItemId;
  if (!itemId) return { error: "This part isn't linked to an inventory item." };
  await db.transaction((tx) => moveStock(tx, { itemId, delta, reason: delta > 0 ? "received" : "used", partId: rows[0].id }, { memberId: member.id, via: "ui" }));
  if (delta > 0) {
    const { usage } = await usageOf([itemId]);
    const covered = usage.get(itemId)?.coveredOf;
    const done = rows.filter(
      (p) => p.inventoryItemId === itemId && p.classification === "cots" && cotsStatusOf(p.designState) !== COTS_IN_STOCK && (covered?.get(p.id) ?? 0) >= Math.max(p.quantity, 1),
    );
    await applyEachPartChanges(done.map((p) => ({ id: p.id, changes: { status: COTS_IN_STOCK } })), { memberId: member.id, via: "ui", receive: false });
  }
  refresh();
  return {};
}

// "Add to inventory" on a COTS card with no item: a new item named after the part, with its
// product link and price, and the part (or every part the card stands for) linked to it.
export async function createItemFromPart(partIds: string[]): Promise<ActionResult> {
  const member = await requireMember();
  if (!partIds.length || partIds.some((id) => !isUuid(id))) return { error: "Unknown part." };
  const rows = await db.select().from(parts).where(inArray(parts.id, partIds));
  const [first] = rows;
  if (!first) return { error: "Unknown part." };
  const name = first.displayName ?? first.onshapeName ?? "Unnamed part";
  const link = first.cotsLinks[0];
  const [item] = await db
    .insert(inventoryItems)
    .values({ name, material: first.classification === "cots" ? null : first.material, vendorUrl: link?.url ?? null, vendorName: link?.site ?? null, price: first.unitPrice })
    .returning({ id: inventoryItems.id });
  await applyEachPartChanges(rows.map((p) => ({ id: p.id, changes: { inventoryItemId: item.id } })), { memberId: member.id, via: "ui" });
  refresh();
  return { message: `Added ${name} to the inventory.` };
}

// The robot inventory page's button: this robot's COTS parts the shelf can't cover, still in
// Not Started or Released, go to the Order List.
export async function sendShortagesToOrder(robotId: string): Promise<ActionResult> {
  const member = await requireMember();
  if (!isUuid(robotId)) return { error: "Unknown robot." };
  const items = await robotInventory(robotId);
  const short = items.flatMap((i) => (i.sheet ? [] : i.parts.filter((p) => p.covered < p.quantity && (p.status === COTS_DEFAULT_STATUS || p.status === COTS_RELEASED))));
  if (!short.length) return { message: "Nothing to order: the shelf covers every part or it's already on the Order List." };
  const { changed } = await applyEachPartChanges(
    short.map((p) => ({ id: p.partId, changes: { status: COTS_ORDERED, cotsSentBack: null } })),
    { memberId: member.id, via: "ui" },
  );
  refresh();
  return { message: `Sent ${changed} part${changed === 1 ? "" : "s"} to the Order List.` };
}

// "Add to a BOM": the item becomes an ordinary COTS part tied to the item.
export async function addItemToBom(itemId: string, systemId: string, quantity: number): Promise<ActionResult> {
  const member = await requireMember();
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
    material: item.material,
    quantity,
    lastModifiedBy: member.id,
  });
  refresh();
  return { message: `Added ${quantity} × ${item.name} to the BOM.` };
}

// ---------- Groups, conditions, locations (editable from the toolbar, like FRCBOM) ----------

const groupForm = z.object({
  name: z.string().trim().min(1, "Group name is required."),
  parentId: ref,
  templateId: text.refine((v) => v === null || !!getPartType(v), "Unknown part type."),
  locationId: ref,
});

export async function saveGroup(groupId: string | null, formData: FormData): Promise<ActionResult> {
  await requireMember();
  const parsed = groupForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (groupId) {
    if (!isUuid(groupId)) return { error: "Unknown group." };
    // A group can't sit under itself or one of its own sub-groups.
    const all = await db.select({ id: inventoryGroups.id, parentId: inventoryGroups.parentId }).from(inventoryGroups);
    for (let p = parsed.data.parentId; p; p = all.find((g) => g.id === p)?.parentId ?? null) {
      if (p === groupId) return { error: "A group can't go inside itself." };
    }
    await db.update(inventoryGroups).set(parsed.data).where(eq(inventoryGroups.id, groupId));
  } else {
    await db.insert(inventoryGroups).values(parsed.data);
  }
  refresh();
  return {};
}

// Sub-groups and items move up to the deleted group's parent.
export async function deleteGroup(groupId: string) {
  await requireMember();
  if (!isUuid(groupId)) return;
  await db.transaction(async (tx) => {
    const [group] = await tx.select().from(inventoryGroups).where(eq(inventoryGroups.id, groupId));
    if (!group) return;
    await tx.update(inventoryGroups).set({ parentId: group.parentId }).where(eq(inventoryGroups.parentId, groupId));
    await tx.update(inventoryItems).set({ groupId: group.parentId }).where(eq(inventoryItems.groupId, groupId));
    await tx.delete(inventoryGroups).where(eq(inventoryGroups.id, groupId));
  });
  refresh();
}

export async function addCondition(label: string, color: string): Promise<ActionResult> {
  await requireMember();
  label = label.trim();
  if (!label) return { error: "Condition name is required." };
  if (!/^#[0-9a-f]{6}$/i.test(color)) return { error: "Pick a color." };
  await db.insert(inventoryConditions).values({ label, color }).onConflictDoNothing();
  refresh();
  return {};
}

export async function deleteCondition(id: string) {
  await requireMember();
  if (isUuid(id)) await db.delete(inventoryConditions).where(eq(inventoryConditions.id, id));
  refresh();
}

export async function addLocation(name: string): Promise<ActionResult> {
  await requireMember();
  name = name.trim();
  if (!name) return { error: "Location name is required." };
  await db.insert(inventoryLocations).values({ name }).onConflictDoNothing();
  refresh();
  return {};
}

export async function deleteLocation(id: string) {
  await requireMember();
  if (isUuid(id)) await db.delete(inventoryLocations).where(eq(inventoryLocations.id, id));
  refresh();
}

// ---------- Spreadsheet import ----------

const importRows = z
  .array(
    z.object({
      name: z.string().trim().min(1),
      inStock: z.number().int().min(0),
      location: z.string().trim().nullable(),
      groupPath: z.array(z.string().trim().min(1)),
      condition: z.string().trim().nullable(),
      material: z.string().trim().nullable(),
    }),
  )
  .max(5000, "Import at most 5000 rows at a time.");

export async function importItems(rows: ImportRow[]): Promise<ActionResult> {
  const member = await requireMember();
  const parsed = importRows.safeParse(rows);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const key = (s: string) => s.toLowerCase();

  const created = await db.transaction(async (tx) => {
    const locations = new Map(
      (await tx.select().from(inventoryLocations)).map((l) => [key(l.name), l.id] as const),
    );
    const conditions = new Map(
      (await tx.select().from(inventoryConditions)).map((c) => [key(c.label), c.id] as const),
    );
    const groups = await tx.select().from(inventoryGroups);
    const counts = { locations: 0, groups: 0, conditions: 0 };

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
      const [item] = await tx.insert(inventoryItems).values({
        name: row.name,
        inStock: row.inStock,
        material: row.material || null,
        locationId: await locationId(row.location),
        conditionId: await conditionId(row.condition),
        groupId: await groupId(row.groupPath),
      }).returning({ id: inventoryItems.id });
      if (row.inStock) await tx.insert(inventoryMoves).values({ itemId: item.id, delta: row.inStock, reason: "counted", memberId: member.id, via: "ui" });
    }
    return counts;
  });

  refresh();
  const extra = [
    created.groups && `${created.groups} groups`,
    created.locations && `${created.locations} locations`,
    created.conditions && `${created.conditions} conditions`,
  ].filter(Boolean);
  return {
    message: `Imported ${parsed.data.length} items${extra.length ? `; created ${extra.join(", ")}` : ""}.`,
  };
}
