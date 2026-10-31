import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { isEditMode } from "@/lib/mode";
import { listBaseMaterials } from "@/lib/data/baseMaterials";
import { listCategories } from "@/lib/data/categories";
import { backupInfo } from "@/lib/storage/backup";
import { RESTORE_SCOPES } from "@/lib/storage/restore";
import { SettingsView } from "./SettingsView";

const { inventoryItems, inventoryConditions, inventoryLocations } = schema;

// The team's lists in one place: inventory categories, base materials, locations, conditions and
// the nightly backups. BOM materials are inventory items now, so they're edited in Inventory.
export default async function SettingsPage() {
  const member = await requireMember();
  // Settings is for admins in Edit mode; the teams land back on their home page.
  if (!(await isEditMode())) redirect("/");
  const [categories, materials, conditions, locations, items, backups, robots] = await Promise.all([
    listCategories(),
    listBaseMaterials(),
    db.select().from(inventoryConditions).orderBy(asc(inventoryConditions.label)),
    db.select().from(inventoryLocations).orderBy(asc(inventoryLocations.name)),
    db.select({ category: inventoryItems.category, specs: inventoryItems.specs }).from(inventoryItems),
    backupInfo(),
    db
      .select({ id: schema.robots.id, name: schema.robots.name, year: schema.robots.year, url: schema.robots.layoutsDocumentUrl })
      .from(schema.robots)
      .where(eq(schema.robots.archived, false))
      .orderBy(desc(schema.robots.year), asc(schema.robots.name)),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="display text-3xl text-accent">Settings</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          The team&apos;s lists. Changes save at once and reach every picker and Claude&apos;s tools. A part&apos;s material is an inventory item, so add materials in Inventory.
        </p>
      </div>
      <SettingsView
        categories={categories}
        materials={materials}
        conditions={conditions}
        locations={locations}
        items={items.map((i) => ({ category: i.category ?? "", specs: i.specs }))}
        backups={backups.all}
        restoreScopes={Object.entries(RESTORE_SCOPES).map(([id, s]) => ({ id, label: s.label, text: s.text }))}
        isAdmin={member.isAdmin}
        robots={robots}
      />
    </div>
  );
}
