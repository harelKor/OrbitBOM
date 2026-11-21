import { asc, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { listCategories } from "@/lib/data/categories";
import { itemThumbs } from "@/lib/data/inventory";
import { ShelfList } from "./ShelfList";

const { inventoryItems } = schema;

// Insert from shelf (Harel, 2026-11-21): inventory items with an Onshape library part linked
// (onshape_key), with their pictures; Insert takes the newest version of the item's document.
export async function ShelfTab({ query, readOnly }: { query: string; readOnly: boolean }) {
  const [items, cats] = await Promise.all([
    db
      .select({ id: inventoryItems.id, name: inventoryItems.name, category: inventoryItems.category, imagePath: inventoryItems.imagePath })
      .from(inventoryItems)
      .where(isNotNull(inventoryItems.onshapeKey))
      .orderBy(asc(inventoryItems.name)),
    listCategories(),
  ]);
  const thumbs = await itemThumbs(items, cats);
  return <ShelfList query={query} readOnly={readOnly} items={items.map((i) => ({ id: i.id, name: i.name, category: i.category, thumb: thumbs.get(i.id) ?? null }))} />;
}
