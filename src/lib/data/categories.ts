import "server-only";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { imageUrl } from "@/lib/storage/r2";
import { DEFAULT_CATEGORIES, groupOf } from "@/config/inventory";
import type { InvCategory } from "@/lib/inventory/categories";
import { MATERIALS } from "@/config/materials";

const { inventoryCategories } = schema;

type Exec = Pick<typeof db, "select" | "insert">;

// The inventory's categories in their order, material fields carrying their materials from
// config/materials.ts. The first read seeds them from config/inventory.ts.
export async function listCategories(exec: Exec = db): Promise<InvCategory[]> {
  let rows = await exec.select().from(inventoryCategories).orderBy(asc(inventoryCategories.position), asc(inventoryCategories.label));
  if (!rows.length) {
    await exec
      .insert(inventoryCategories)
      .values(DEFAULT_CATEGORIES.map((c, i) => ({ id: c.id, label: c.label, noun: c.noun, group: c.group, sheet: !!c.sheet, position: i, fields: c.fields, image: c.image ?? null })))
      .onConflictDoNothing();
    rows = await exec.select().from(inventoryCategories).orderBy(asc(inventoryCategories.position), asc(inventoryCategories.label));
  }
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    noun: r.noun,
    group: groupOf(r.group),
    sheet: r.sheet,
    image: r.image,
    defaultLocationId: r.defaultLocationId,
    fields: r.fields.map((f) => (f.kind === "material" ? { ...f, materialChoices: (f.materials ?? []).flatMap((g) => MATERIALS[g] ?? []) } : f)),
  }));
}

// A category picture's link. One in public/categories/ ("/categories/gears.png") is used as is, so
// the browser caches it and nothing is signed; anything else is an R2 key.
export async function categoryImageUrl(image: string | null): Promise<string | null> {
  if (!image) return null;
  return image.startsWith("/") ? image : imageUrl(image);
}
