"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPartType } from "@/config/partTypes";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import type { ImportRow } from "@/lib/inventory/import";
import { isUuid } from "@/lib/uuid";

const { inventoryItems, inventoryGroups, inventoryConditions, inventoryLocations } = schema;

export type ActionResult = { error?: string; message?: string };

const refresh = () => {
  revalidatePath("/inventory");
  revalidatePath("/robots", "layout");
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
  inStock: z.coerce.number().int().min(0, "In stock can't be negative."),
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
  await requireMember();
  const parsed = itemForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const type = parsed.data.templateId ? getPartType(parsed.data.templateId) : undefined;
  const templateValues: Record<string, string> = {};
  for (const field of type?.fields ?? []) {
    const v = String(formData.get(`tv.${field.id}`) ?? "").trim();
    if (v) templateValues[field.id] = v;
  }
  const values = { ...parsed.data, templateValues };
  if (itemId) {
    if (!isUuid(itemId)) return { error: "Unknown item." };
    await db.update(inventoryItems).set(values).where(eq(inventoryItems.id, itemId));
  } else {
    await db.insert(inventoryItems).values(values);
  }
  refresh();
  return {};
}

export async function deleteItem(itemId: string) {
  await requireMember();
  if (!isUuid(itemId)) return;
  await db.delete(inventoryItems).where(eq(inventoryItems.id, itemId));
  refresh();
}

// The − / + stepper.
export async function adjustStock(itemId: string, delta: number): Promise<ActionResult> {
  await requireMember();
  if (!isUuid(itemId) || !Number.isInteger(delta)) return { error: "Unknown item." };
  await db
    .update(inventoryItems)
    .set({ inStock: sql`greatest(${inventoryItems.inStock} + ${delta}, 0)` })
    .where(eq(inventoryItems.id, itemId));
  refresh();
  return {};
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
  await requireMember();
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
      await tx.insert(inventoryItems).values({
        name: row.name,
        inStock: row.inStock,
        material: row.material || null,
        locationId: await locationId(row.location),
        conditionId: await conditionId(row.condition),
        groupId: await groupId(row.groupPath),
      });
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
