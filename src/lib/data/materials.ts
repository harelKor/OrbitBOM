import "server-only";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { CATEGORY_GROUPS } from "@/config/inventory";
import { categoryOf } from "@/lib/inventory/categories";
import { formatStock } from "@/lib/inventory/stock";
import { listCategories } from "./categories";

const { inventoryItems } = schema;

// A BOM part's material is an inventory item (Harel, 2026-10-30): the Raw Stock categories first,
// then every other category that has items. `label` tells apart items that share a name (the
// carbon tubes come in two lengths); `name` is what the part's material saves.
export type MaterialItem = { id: string; name: string; label: string; stock: string; specs: Record<string, string> };
export type MaterialGroup = { id: string; label: string; raw: boolean; items: MaterialItem[] };

type Exec = Pick<typeof db, "select" | "insert">;

export async function listMaterialGroups(exec: Exec = db): Promise<MaterialGroup[]> {
  const [cats, items] = await Promise.all([
    listCategories(exec),
    exec
      .select({ id: inventoryItems.id, name: inventoryItems.name, category: inventoryItems.category, specs: inventoryItems.specs, inStock: inventoryItems.inStock })
      .from(inventoryItems)
      .orderBy(asc(inventoryItems.name)),
  ]);
  const byCat = new Map<string, typeof items>();
  for (const i of items) {
    const c = categoryOf(i, cats);
    byCat.set(c, [...(byCat.get(c) ?? []), i]);
  }
  const groupRank = (g: string) => (g === "consumables" ? -1 : CATEGORY_GROUPS.findIndex((x) => x.id === g));
  return cats
    .map((c, i) => ({ c, i }))
    .sort((a, b) => groupRank(a.c.group) - groupRank(b.c.group) || a.i - b.i)
    .flatMap(({ c }) => {
      const list = byCat.get(c.id) ?? [];
      if (!list.length && c.group !== "consumables") return [];
      const counts = new Map<string, number>();
      for (const i of list) counts.set(i.name, (counts.get(i.name) ?? 0) + 1);
      return [
        {
          id: c.id,
          label: c.label,
          raw: c.group === "consumables",
          items: list.map((i) => ({
            id: i.id,
            name: i.name,
            label: (counts.get(i.name) ?? 0) > 1 ? `${i.name} · ${i.specs.length ?? i.specs.size ?? i.specs.color ?? i.id.slice(0, 4)}` : i.name,
            stock: formatStock(i.inStock, c.sheet),
            specs: i.specs,
          })),
        },
      ];
    });
}

// The Raw Stock items, for Suggest setup and Claude's set_up_parts.
export async function listRawStock(exec: Exec = db) {
  return (await listMaterialGroups(exec)).filter((g) => g.raw).flatMap((g) => g.items.map((i) => ({ ...i, category: g.id })));
}
export type RawStockItem = Awaited<ReturnType<typeof listRawStock>>[number];
