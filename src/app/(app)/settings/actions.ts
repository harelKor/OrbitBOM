"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireCapability } from "@/lib/mode";
import { isUuid } from "@/lib/uuid";

const { inventoryConditions, inventoryLocations } = schema;

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
