import "server-only";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import type { InvCategory } from "@/lib/inventory/categories";

const { inventoryCategories } = schema;

type Exec = Pick<typeof db, "select" | "insert">;

// The inventory's categories in their order. The first read seeds them from config/inventory.ts.
export async function listCategories(exec: Exec = db): Promise<InvCategory[]> {
  let rows = await exec.select().from(inventoryCategories).orderBy(asc(inventoryCategories.position), asc(inventoryCategories.label));
  if (!rows.length) {
    await exec
      .insert(inventoryCategories)
      .values(DEFAULT_CATEGORIES.map((c, i) => ({ id: c.id, label: c.label, noun: c.noun, sheet: !!c.sheet, position: i, fields: c.fields })))
      .onConflictDoNothing();
    rows = await exec.select().from(inventoryCategories).orderBy(asc(inventoryCategories.position), asc(inventoryCategories.label));
  }
  return rows.map((r) => ({ id: r.id, label: r.label, noun: r.noun, sheet: r.sheet, image: r.image, defaultLocationId: r.defaultLocationId, fields: r.fields }));
}
