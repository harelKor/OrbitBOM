import "server-only";
import { db, schema } from "@/db";
import { listCategories } from "@/lib/data/categories";

// One-off (Harel, 2026-10-28): category fields audited against the items in them, item specs
// filled in from names and notes, unit-only notes dropped. Runs from /api/cron/inventory-seed.

const { inventoryItems } = schema;

// Every category with its fields and its items' name, specs and note, for reading over.
export async function auditInventory() {
  const cats = await listCategories();
  const items = await db
    .select({
      name: inventoryItems.name,
      category: inventoryItems.category,
      specs: inventoryItems.specs,
      note: inventoryItems.note,
    })
    .from(inventoryItems);
  return cats
    .map((c) => ({
      id: c.id,
      fields: c.fields.map(
        (f) => `${f.id}:${f.kind}${f.name ? `(${f.name})` : ""}`,
      ),
      items: items
        .filter((i) => i.category === c.id)
        .map((i) =>
          [
            i.name,
            Object.entries(i.specs)
              .map(([k, v]) => `${k}=${v}`)
              .join(";"),
            i.note ?? "",
          ]
            .filter(Boolean)
            .join(" | "),
        )
        .sort(),
    }))
    .concat([
      {
        id: "(none)",
        fields: [],
        items: items.filter((i) => !i.category).map((i) => i.name),
      },
    ]);
}
