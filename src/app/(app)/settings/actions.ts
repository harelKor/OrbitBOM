"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { listMaterials } from "@/lib/data/materials";
import { applyEachPartChanges } from "@/lib/parts/apply";
import { isUuid } from "@/lib/uuid";

const { materialGroups, materialColors, inventoryCategories, inventoryItems, inventoryConditions, inventoryLocations, parts } = schema;

export type ActionResult = { error?: string; message?: string };

// The material list and the inventory lists sit in the shell (pickers, sidebar), so every page
// reads them again.
const refresh = () => revalidatePath("/", "layout");

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const cleanName = (s: string) => s.trim().replace(/\s+/g, " ");

// Reads the groups locked for the change, in list order (seeding them on the first read).
async function lockedGroups(tx: Tx) {
  await listMaterials(tx);
  return tx.select().from(materialGroups).orderBy(asc(materialGroups.position), asc(materialGroups.name)).for("update");
}

const whereIs = (groups: { name: string; materials: string[] }[], material: string) =>
  groups.find((g) => g.materials.some((m) => m.toLowerCase() === material.toLowerCase()));

// ---------- Material groups ----------

export async function addMaterialGroup(name: string): Promise<ActionResult> {
  await requireMember();
  name = cleanName(name);
  if (!name) return { error: "A group needs a name." };
  if (name.length > 60) return { error: "Keep the name under 60 characters." };
  const error = await db.transaction(async (tx) => {
    const groups = await lockedGroups(tx);
    if (groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) return `There is already a group "${name}".`;
    await tx.insert(materialGroups).values({ name, position: groups.length });
  });
  if (error) return { error };
  refresh();
  return {};
}

// A group's name also keys its 3D colour and the inventory fields that offer its materials.
export async function renameMaterialGroup(from: string, to: string): Promise<ActionResult> {
  await requireMember();
  to = cleanName(to);
  if (!to) return { error: "A group needs a name." };
  if (to === from) return {};
  const error = await db.transaction(async (tx) => {
    const groups = await lockedGroups(tx);
    if (!groups.some((g) => g.name === from)) return "That group is gone.";
    if (groups.some((g) => g.name !== from && g.name.toLowerCase() === to.toLowerCase())) return `There is already a group "${to}".`;
    await tx.update(materialGroups).set({ name: to, updatedAt: new Date() }).where(eq(materialGroups.name, from));
    await tx.delete(materialColors).where(eq(materialColors.category, to));
    await tx.update(materialColors).set({ category: to }).where(eq(materialColors.category, from));
    await renameInCategoryFields(tx, (list) => list.map((g) => (g === from ? to : g)));
  });
  if (error) return { error };
  refresh();
  return {};
}

// Parts keep the material names they have; they just aren't on the list any more.
export async function deleteMaterialGroup(name: string): Promise<ActionResult> {
  await requireMember();
  await db.transaction(async (tx) => {
    const groups = await lockedGroups(tx);
    await tx.delete(materialGroups).where(eq(materialGroups.name, name));
    await tx.delete(materialColors).where(eq(materialColors.category, name));
    await renameInCategoryFields(tx, (list) => list.filter((g) => g !== name));
    for (const [i, g] of groups.filter((g) => g.name !== name).entries())
      if (g.position !== i) await tx.update(materialGroups).set({ position: i }).where(eq(materialGroups.name, g.name));
  });
  refresh();
  return {};
}

export async function moveMaterialGroup(name: string, by: -1 | 1): Promise<ActionResult> {
  await requireMember();
  await db.transaction(async (tx) => {
    const order = [...(await lockedGroups(tx))];
    const from = order.findIndex((g) => g.name === name);
    const to = from + by;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    for (const [i, g] of order.entries()) await tx.update(materialGroups).set({ position: i }).where(eq(materialGroups.name, g.name));
  });
  refresh();
  return {};
}

// Inventory "BOM material" fields name the groups they offer.
async function renameInCategoryFields(tx: Tx, change: (groups: string[]) => string[]) {
  const cats = await tx.select({ id: inventoryCategories.id, fields: inventoryCategories.fields }).from(inventoryCategories);
  for (const c of cats) {
    let changed = false;
    const fields = c.fields.map((f) => {
      if (f.kind !== "material" || !f.materials) return f;
      const next = change(f.materials);
      if (next.join("\n") === f.materials.join("\n")) return f;
      changed = true;
      return { ...f, materials: next };
    });
    if (changed) await tx.update(inventoryCategories).set({ fields }).where(eq(inventoryCategories.id, c.id));
  }
}

// ---------- Materials ----------

export async function addMaterial(group: string, name: string): Promise<ActionResult> {
  await requireMember();
  name = cleanName(name);
  if (!name) return { error: "Type the material's name." };
  if (name.length > 80) return { error: "Keep the name under 80 characters." };
  const error = await db.transaction(async (tx) => {
    const groups = await lockedGroups(tx);
    const g = groups.find((x) => x.name === group);
    if (!g) return "That group is gone.";
    const taken = whereIs(groups, name);
    if (taken) return `"${name}" is already in ${taken.name}.`;
    await tx.update(materialGroups).set({ materials: [...g.materials, name], updatedAt: new Date() }).where(eq(materialGroups.name, group));
  });
  if (error) return { error };
  refresh();
  return {};
}

export async function removeMaterial(group: string, name: string): Promise<ActionResult> {
  await requireMember();
  await db.transaction(async (tx) => {
    const g = (await lockedGroups(tx)).find((x) => x.name === group);
    if (g) await tx.update(materialGroups).set({ materials: g.materials.filter((m) => m !== name), updatedAt: new Date() }).where(eq(materialGroups.name, group));
  });
  refresh();
  return {};
}

// Renames a material on the list; with `updateUses`, the BOM parts and inventory items that use
// the old name take the new one too (parts through part history, so Undo can put them back).
export async function renameMaterial(group: string, from: string, to: string, updateUses: boolean): Promise<ActionResult> {
  const member = await requireMember();
  to = cleanName(to);
  if (!to) return { error: "Type the material's name." };
  if (to === from) return {};
  const error = await db.transaction(async (tx) => {
    const groups = await lockedGroups(tx);
    const g = groups.find((x) => x.name === group);
    if (!g || !g.materials.includes(from)) return "That material is gone.";
    const taken = whereIs(groups, to);
    if (taken && !(taken.name === group && to.toLowerCase() === from.toLowerCase())) return `"${to}" is already in ${taken.name}.`;
    await tx.update(materialGroups).set({ materials: g.materials.map((m) => (m === from ? to : m)), updatedAt: new Date() }).where(eq(materialGroups.name, group));
  });
  if (error) return { error };

  let message: string | undefined;
  if (updateUses) {
    const using = await db.select({ id: parts.id }).from(parts).where(eq(parts.material, from));
    const { changed } = await applyEachPartChanges(using.map((p) => ({ id: p.id, changes: { material: to } })), { memberId: member.id, via: "ui" });
    const items = await renameInItems(from, to);
    message = `Renamed to ${to} on ${changed} part${changed === 1 ? "" : "s"} and ${items} inventory item${items === 1 ? "" : "s"}.`;
  }
  refresh();
  return { message };
}

// Every inventory value of a "BOM material" field (the `material` spec, and any other field of
// that kind) that holds the old name.
async function renameInItems(from: string, to: string): Promise<number> {
  const cats = await db.select({ id: inventoryCategories.id, fields: inventoryCategories.fields }).from(inventoryCategories);
  const keys = new Set(["material", ...cats.flatMap((c) => c.fields.filter((f) => f.kind === "material").map((f) => f.id))]);
  let n = 0;
  for (const key of keys) {
    const rows = await db
      .update(inventoryItems)
      .set({ specs: sql`jsonb_set(${inventoryItems.specs}, array[${key}::text], to_jsonb(${to}::text))` })
      .where(sql`${inventoryItems.specs} ->> ${key} = ${from}`)
      .returning({ id: inventoryItems.id });
    n += rows.length;
  }
  return n;
}

// ---------- 3D colours ----------

// A group's colour in the 3D viewer's Material mode; null puts the default back.
export async function setMaterialColor(group: string, color: string | null): Promise<ActionResult> {
  const member = await requireMember();
  if (color === null) {
    await db.delete(materialColors).where(eq(materialColors.category, group));
  } else {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return { error: "Pick a color." };
    await db
      .insert(materialColors)
      .values({ category: group, color, updatedBy: member.id })
      .onConflictDoUpdate({ target: materialColors.category, set: { color, updatedBy: member.id, updatedAt: new Date() } });
  }
  refresh();
  return {};
}

// ---------- Inventory locations and conditions ----------

export async function renameLocation(id: string, name: string): Promise<ActionResult> {
  await requireMember();
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
  await requireMember();
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
