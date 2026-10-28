import { asc, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireMember } from "@/lib/auth";
import { listCategories } from "@/lib/data/categories";
import { listMaterialColors } from "@/lib/data/materialColors";
import { listMaterials } from "@/lib/data/materials";
import { SettingsView } from "./SettingsView";

const { parts, inventoryItems, inventoryConditions, inventoryLocations } = schema;

// The team's lists in one place: materials (with their 3D colours), inventory categories,
// locations and conditions.
export default async function SettingsPage() {
  await requireMember();
  const [materials, colors, categories, conditions, locations, items, partUses, itemUses] = await Promise.all([
    listMaterials(),
    listMaterialColors(),
    listCategories(),
    db.select().from(inventoryConditions).orderBy(asc(inventoryConditions.label)),
    db.select().from(inventoryLocations).orderBy(asc(inventoryLocations.name)),
    db.select({ category: inventoryItems.category, specs: inventoryItems.specs }).from(inventoryItems),
    db
      .select({ material: parts.material, n: sql<number>`count(*)::int` })
      .from(parts)
      .where(isNotNull(parts.material))
      .groupBy(parts.material),
    db
      .select({ material: sql<string>`${inventoryItems.specs} ->> 'material'`, n: sql<number>`count(*)::int` })
      .from(inventoryItems)
      .where(sql`${inventoryItems.specs} ->> 'material' is not null`)
      .groupBy(sql`${inventoryItems.specs} ->> 'material'`),
  ]);

  const uses: Record<string, { parts: number; items: number }> = {};
  for (const r of partUses) if (r.material) (uses[r.material] ??= { parts: 0, items: 0 }).parts = r.n;
  for (const r of itemUses) if (r.material) (uses[r.material] ??= { parts: 0, items: 0 }).items = r.n;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="display text-3xl text-accent">Settings</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          The team&apos;s lists. Changes save at once and reach every picker, the 3D viewer and Claude&apos;s tools.
        </p>
      </div>
      <SettingsView
        materials={materials}
        colors={colors}
        uses={uses}
        categories={categories}
        conditions={conditions}
        locations={locations}
        items={items.map((i) => ({ category: i.category ?? "", specs: i.specs }))}
      />
    </div>
  );
}
