"use server";

import { and, eq, max, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireCapability } from "@/lib/mode";
import { isUuid } from "@/lib/uuid";

const { baseMaterials, inventoryCategories, inventoryConditions, inventoryItems, inventoryLocations } = schema;

export type ActionResult = { error?: string; message?: string };

// The inventory lists sit in the shell (pickers, sidebar), so every page reads them again.
const refresh = () => revalidatePath("/", "layout");

const cleanName = (s: string) => s.trim().replace(/\s+/g, " ");

// ---------- Inventory locations and conditions ----------

export async function renameLocation(id: string, name: string): Promise<ActionResult> {
  await requireCapability("manage");
  name = cleanName(name);
  if (!isUuid(id)) return { error: "Unknown location." };
  if (!name) return { error: "Location name is required." };
  const [clash] = await db.select({ id: inventoryLocations.id }).from(inventoryLocations).where(and(eq(inventoryLocations.name, name), sql`${inventoryLocations.id} <> ${id}`));
  if (clash) return { error: `There is already a location "${name}".` };
  await db.update(inventoryLocations).set({ name }).where(eq(inventoryLocations.id, id));
  refresh();
  return {};
}

export async function updateCondition(id: string, values: { label?: string; color?: string }): Promise<ActionResult> {
  await requireCapability("manage");
  if (!isUuid(id)) return { error: "Unknown condition." };
  const set: { label?: string; color?: string } = {};
  if (values.label !== undefined) {
    const label = cleanName(values.label);
    if (!label) return { error: "Condition name is required." };
    const [clash] = await db.select({ id: inventoryConditions.id }).from(inventoryConditions).where(and(eq(inventoryConditions.label, label), sql`${inventoryConditions.id} <> ${id}`));
    if (clash) return { error: `There is already a condition "${label}".` };
    set.label = label;
  }
  if (values.color !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(values.color)) return { error: "Pick a color." };
    set.color = values.color;
  }
  if (Object.keys(set).length) await db.update(inventoryConditions).set(set).where(eq(inventoryConditions.id, id));
  refresh();
  return {};
}

// ---------- Base materials (what inventory material fields offer) ----------

const nameTaken = async (name: string, id?: string) => {
  const [clash] = await db
    .select({ id: baseMaterials.id })
    .from(baseMaterials)
    .where(id ? and(sql`lower(${baseMaterials.name}) = lower(${name})`, sql`${baseMaterials.id} <> ${id}`) : sql`lower(${baseMaterials.name}) = lower(${name})`);
  return !!clash;
};

export async function addBaseMaterial(name: string): Promise<ActionResult> {
  await requireCapability("manage");
  name = cleanName(name).slice(0, 60);
  if (!name) return { error: "A material needs a name." };
  if (await nameTaken(name)) return { error: `"${name}" is already on the list.` };
  const [{ last }] = await db.select({ last: max(baseMaterials.position) }).from(baseMaterials);
  await db.insert(baseMaterials).values({ name, position: (last ?? -1) + 1 });
  refresh();
  return {};
}

// A rename reaches the categories' material fields that list it and the items holding it.
export async function renameBaseMaterial(id: string, name: string): Promise<ActionResult> {
  await requireCapability("manage");
  name = cleanName(name).slice(0, 60);
  if (!isUuid(id)) return { error: "Unknown material." };
  if (!name) return { error: "A material needs a name." };
  if (await nameTaken(name, id)) return { error: `"${name}" is already on the list.` };
  const [row] = await db.select().from(baseMaterials).where(eq(baseMaterials.id, id));
  if (!row) return { error: "That material was deleted." };
  const old = row.name;
  let items = 0;
  await db.transaction(async (tx) => {
    await tx.update(baseMaterials).set({ name }).where(eq(baseMaterials.id, id));
    for (const cat of await tx.select().from(inventoryCategories)) {
      const fields = cat.fields.filter((f) => f.kind === "material");
      if (!fields.length) continue;
      if (fields.some((f) => f.options?.includes(old)))
        await tx
          .update(inventoryCategories)
          .set({ fields: cat.fields.map((f) => (f.kind === "material" && f.options?.includes(old) ? { ...f, options: f.options.map((o) => (o === old ? name : o)) } : f)) })
          .where(eq(inventoryCategories.id, cat.id));
      for (const f of fields) {
        const done = await tx
          .update(inventoryItems)
          .set({ specs: sql`jsonb_set(${inventoryItems.specs}, ${`{${f.id}}`}::text[], to_jsonb(${name}::text))` })
          .where(and(eq(inventoryItems.category, cat.id), sql`${inventoryItems.specs}->>${f.id} = ${old}`))
          .returning({ id: inventoryItems.id });
        items += done.length;
      }
    }
  });
  refresh();
  return items ? { message: `Renamed to ${name} on ${items} item${items === 1 ? "" : "s"}.` } : {};
}

// Items that hold a removed material keep it as their value; fields that listed it drop it.
export async function deleteBaseMaterial(id: string): Promise<ActionResult> {
  await requireCapability("manage");
  if (!isUuid(id)) return { error: "Unknown material." };
  const [row] = await db.select().from(baseMaterials).where(eq(baseMaterials.id, id));
  if (!row) return {};
  await db.transaction(async (tx) => {
    await tx.delete(baseMaterials).where(eq(baseMaterials.id, id));
    for (const cat of await tx.select().from(inventoryCategories)) {
      if (!cat.fields.some((f) => f.kind === "material" && f.options?.includes(row.name))) continue;
      await tx
        .update(inventoryCategories)
        .set({ fields: cat.fields.map((f) => (f.kind === "material" && f.options ? { ...f, options: f.options.filter((o) => o !== row.name) } : f)) })
        .where(eq(inventoryCategories.id, cat.id));
    }
  });
  refresh();
  return {};
}
