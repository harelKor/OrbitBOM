import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { isEditMode } from "@/lib/mode";
import { listBaseMaterials } from "@/lib/data/baseMaterials";
import { listBores } from "@/lib/data/bores";
import { listCategories } from "@/lib/data/categories";
import { listPlaces } from "@/lib/data/places";
import { backupInfo } from "@/lib/storage/backup";
import { RESTORE_SCOPES } from "@/lib/storage/restore";
import { KEEP_DAYS, listTrash } from "@/lib/trash";
import { SettingsView } from "./SettingsView";

const { inventoryItems, inventoryConditions } = schema;

// The team's lists in one place: inventory categories, base materials, the Bore list, locations, conditions and
// the nightly backups, and what was deleted lately. BOM materials are inventory items now, so they're edited in Inventory.
export default async function SettingsPage() {
  const member = await requireMember();
  // Settings is for admins in Edit mode; the teams land back on their home page.
  if (!(await isEditMode())) redirect("/");
  const [categories, materials, boreList, conditions, locations, items, backups, robots, deleted] = await Promise.all([
    listCategories(),
    listBaseMaterials(),
    listBores(),
    db.select().from(inventoryConditions).orderBy(asc(inventoryConditions.label)),
    listPlaces(),
    db.select({ category: inventoryItems.category, specs: inventoryItems.specs }).from(inventoryItems),
    backupInfo(),
    db
      .select({ id: schema.robots.id, name: schema.robots.name, year: schema.robots.year, url: schema.robots.layoutsDocumentUrl })
      .from(schema.robots)
      .where(eq(schema.robots.archived, false))
      .orderBy(desc(schema.robots.year), asc(schema.robots.name)),
    listTrash(),
  ]);
  // Systems of the robots in use, for Map → System drawers.
  const drawerSystems = await db
    .select({ id: schema.systems.id, name: schema.systems.name, robot: schema.robots.name, drawers: schema.systems.drawers })
    .from(schema.systems)
    .innerJoin(schema.robots, eq(schema.robots.id, schema.systems.robotId))
    .where(eq(schema.robots.archived, false))
    .orderBy(desc(schema.robots.year), asc(schema.robots.name), asc(schema.systems.name));

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
        bores={boreList}
        conditions={conditions}
        locations={locations}
        drawerSystems={drawerSystems}
        items={items.map((i) => ({ category: i.category ?? "", specs: i.specs }))}
        backups={backups.all}
        restoreScopes={Object.entries(RESTORE_SCOPES).map(([id, s]) => ({ id, label: s.label, text: s.text }))}
        isAdmin={member.isAdmin}
        robots={robots}
        deleted={deleted.map((d) => ({ ...d, deletedAt: d.deletedAt.toISOString() }))}
        keepDays={KEEP_DAYS}
      />
    </div>
  );
}
