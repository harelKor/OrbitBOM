import "server-only";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { imageUrl } from "@/lib/storage/r2";
import { DEFAULT_CATEGORIES, groupOf } from "@/config/inventory";
import type { InvCategory } from "@/lib/inventory/categories";
import { MATERIALS } from "@/config/materials";
import { listBaseMaterials } from "./baseMaterials";
import { cached } from "./cache";

const { inventoryCategories } = schema;

type Exec = Pick<typeof db, "select" | "insert">;

// The inventory's categories in their order, material fields carrying their choices: the
// field's own `options` (a few base materials), else the team's whole base material list (an old
// field still naming config/materials.ts groups keeps those). The first read seeds them from
// config/inventory.ts. Kept in memory between changes (cache.ts); a transaction reads its own.
export async function listCategories(exec: Exec = db): Promise<InvCategory[]> {
  return exec === db ? cached("categories", ["inventory_categories", "base_materials"], () => loadCategories(db)) : loadCategories(exec);
}

async function loadCategories(exec: Exec): Promise<InvCategory[]> {
  let rows = await exec.select().from(inventoryCategories).orderBy(asc(inventoryCategories.position), asc(inventoryCategories.label));
  if (!rows.length) {
    await exec
      .insert(inventoryCategories)
      .values(DEFAULT_CATEGORIES.map((c, i) => ({ id: c.id, label: c.label, noun: c.noun, group: c.group, sheet: !!c.sheet, position: i, fields: c.fields, image: c.image ?? null })))
      .onConflictDoNothing();
    rows = await exec.select().from(inventoryCategories).orderBy(asc(inventoryCategories.position), asc(inventoryCategories.label));
  }
  const base = rows.some((r) => r.fields.some((f) => f.kind === "material")) ? (await listBaseMaterials(exec)).map((m) => m.name) : [];
  const choices = (f: InvCategory["fields"][number]) =>
    f.options?.length ? f.options : f.materials?.length ? f.materials.flatMap((g) => MATERIALS[g] ?? []) : base;
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    noun: r.noun,
    group: groupOf(r.group),
    sheet: r.sheet,
    image: r.image,
    defaultLocationId: r.defaultLocationId,
    fields: r.fields.map((f) => (f.kind === "material" ? { ...f, materialChoices: choices(f) } : f)),
  }));
}

// A category picture's link. One in public/categories/ ("/categories/gears.png") is used as is, so
// the browser caches it and nothing is signed; anything else is an R2 key.
export async function categoryImageUrl(image: string | null): Promise<string | null> {
  if (!image) return null;
  return image.startsWith("/") ? image : imageUrl(image);
}
