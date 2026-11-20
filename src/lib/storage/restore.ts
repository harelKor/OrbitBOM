import "server-only";
import { gunzipSync } from "node:zlib";
import { getTableColumns, getTableName, inArray, notInArray, sql, type Table } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { BACKUP_TABLES, isBackupKey, saveNightlyBackup } from "./backup";
import { getObject } from "./r2";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type BackupTable = keyof typeof BACKUP_TABLES;
type Row = Record<string, unknown>;

// What a restore can bring back. Each scope's tables in parent-first order.
export const RESTORE_SCOPES = {
  inventory: {
    label: "Inventory",
    text: "Items, stock and stock moves, devices, categories with their fields, base materials, the Bore list, groups, locations and conditions.",
    tables: ["inventoryLocations", "inventoryConditions", "baseMaterials", "bores", "inventoryGroups", "inventoryCategories", "inventoryItems", "inventoryMoves", "inventoryDevices"],
  },
  bom: {
    label: "BOM",
    text: "Robots, systems, parts with their status, counts and notes, fab batches, merges, file and drawing links, and the material list.",
    tables: ["robots", "systems", "parts", "partFiles", "partDrawings", "partGroups", "groupMembers", "groupFiles", "merges", "mergeMembers", "materialGroups", "materialColors"],
  },
} as const satisfies Record<string, { label: string; text: string; tables: BackupTable[] }>;
export type RestoreScope = keyof typeof RESTORE_SCOPES;

// Link tables are replaced whole; the rest are matched by id, so rows that were in the backup
// keep their history. Rows added since stay unless `removeAdded` is chosen: removing a robot,
// system or part also removes its history and versions, which no backup holds.
const REPLACE_WHOLE: BackupTable[] = ["groupMembers", "mergeMembers"];
// Names that must stay unique while rows swap them.
const UNIQUE_NAMES: Partial<Record<BackupTable, string>> = { inventoryLocations: "name", inventoryConditions: "label", baseMaterials: "name", bores: "name" };

export type RestoreResult = { safetyCopy: string | null; tables: { table: string; restored: number; removed: number }[] };

export async function readBackup(key: string): Promise<{ at: string; tables: Record<string, Row[]> }> {
  if (!isBackupKey(key)) throw new Error("Unknown backup.");
  const res = await getObject(key);
  if (!res) throw new Error("That backup is gone from storage.");
  const data = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString());
  if (data?.app !== "OrbitParts" || typeof data.tables !== "object") throw new Error("That file isn't an OrbitParts backup.");
  return data;
}

// Puts the chosen parts of the app back the way a backup has them. A copy of how things are now
// is saved first (orbitparts-YYYY-MM-DD-before-restore-HHMM), so a restore can itself be undone
// by restoring that copy. Tables an older backup doesn't hold are left as they are.
export async function restoreBackup(key: string, scopes: RestoreScope[], { removeAdded = false }: { removeAdded?: boolean } = {}): Promise<RestoreResult> {
  if (!scopes.length) throw new Error("Pick what to restore.");
  const backup = await readBackup(key);
  // To the second, so two restores in the same minute don't overwrite each other's copy.
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  const safety = await saveNightlyBackup(`before-restore-${stamp}`);
  if ("skipped" in safety) throw new Error(`Not restored: ${safety.skipped}.`);
  const names = new Set<BackupTable>(scopes.flatMap((s) => RESTORE_SCOPES[s].tables));
  // Parent-first across both scopes (parts link to inventory items, so inventory goes first).
  const order = [...RESTORE_SCOPES.inventory.tables, ...RESTORE_SCOPES.bom.tables].filter((t) => names.has(t) && Array.isArray(backup.tables[t]));

  const inScope = new Set(order.map((t) => getTableName(BACKUP_TABLES[t])));

  const tables = await db.transaction(async (tx) => {
    const out: RestoreResult["tables"] = [];
    for (const name of order) out.push({ table: name, ...(await restoreTable(tx, name, backup.tables[name], inScope, removeAdded)) });
    return out;
  });
  return { safetyCopy: safety.key, tables };
}

async function restoreTable(tx: Tx, name: BackupTable, saved: Row[], inScope: Set<string>, removeAdded: boolean) {
  const table = BACKUP_TABLES[name] as PgTable;
  const columns = getTableColumns(table as Table) as Record<string, PgTable["_"]["columns"][string]>;
  const pk = Object.entries(columns).filter(([, c]) => c.primary);
  const rows = await cleanRows(tx, table, columns, saved, inScope);

  if (REPLACE_WHOLE.includes(name) || pk.length !== 1) {
    // Kept: the backup's links are added back next to the ones made since.
    if (!removeAdded) {
      for (let i = 0; i < rows.length; i += 500) await tx.insert(table).values(rows.slice(i, i + 500)).onConflictDoNothing();
      return { restored: rows.length, removed: 0 };
    }
    const removed = (await tx.delete(table)).rowCount ?? 0;
    for (let i = 0; i < rows.length; i += 500) await tx.insert(table).values(rows.slice(i, i + 500));
    return { restored: rows.length, removed: Math.max(0, removed - rows.length) };
  }

  const [pkKey, pkCol] = pk[0];
  const ids = rows.map((r) => r[pkKey]);
  // Rows added since the backup go only when asked (with what hangs off them, as deleting them in
  // the app would).
  const removed = removeAdded ? ((await tx.delete(table).where(ids.length ? notInArray(pkCol, ids) : undefined)).rowCount ?? 0) : 0;
  const unique = UNIQUE_NAMES[name];
  if (unique && ids.length) {
    const col = columns[unique];
    await tx.update(table).set({ [unique]: sql`${col} || ' ~' || ${pkCol}::text` }).where(inArray(pkCol, ids));
  }
  const set = Object.fromEntries(Object.entries(columns).filter(([k]) => k !== pkKey).map(([k, c]) => [k, sql.raw(`excluded."${c.name}"`)]));
  for (let i = 0; i < rows.length; i += 500) {
    await tx.insert(table).values(rows.slice(i, i + 500)).onConflictDoUpdate({ target: pkCol, set });
  }
  return { restored: rows.length, removed };
}

// JSON turns dates into text; links to rows outside what is restored (a member who left, an
// item deleted since) are emptied, or the row is skipped when the link can't be empty. Links to
// tables restored in the same run hold, since those go parent-first.
async function cleanRows(tx: Tx, table: PgTable, columns: Record<string, PgTable["_"]["columns"][string]>, saved: Row[], inScope: Set<string>) {
  const keyOf = new Map(Object.entries(columns).map(([k, c]) => [c.name, k]));
  const self = getTableName(table);
  let rows = saved.map((r) => {
    const row: Row = {};
    for (const [k, c] of Object.entries(columns)) {
      if (!(k in r)) continue;
      const v = r[k];
      row[k] = c.dataType === "date" && typeof v === "string" ? new Date(v) : v;
    }
    return row;
  });
  for (const fk of getTableConfig(table).foreignKeys) {
    const ref = fk.reference();
    const target = getTableName(ref.foreignTable);
    if (ref.columns.length !== 1 || (target !== self && inScope.has(target))) continue;
    const key = keyOf.get(ref.columns[0].name)!;
    let live: Set<unknown>;
    if (target === self) {
      // A parent row of the same table (a group in a group) is kept when the backup has it.
      live = new Set(rows.map((r) => r[keyOf.get(ref.foreignColumns[0].name)!]));
    } else {
      const wanted = [...new Set(rows.map((r) => r[key]).filter((v) => v != null))] as string[];
      if (!wanted.length) continue;
      const found = await tx.select({ id: ref.foreignColumns[0] }).from(ref.foreignTable).where(inArray(ref.foreignColumns[0], wanted));
      live = new Set(found.map((f) => f.id));
    }
    const nullable = !ref.columns[0].notNull;
    rows = rows.flatMap((r) => (r[key] == null || live.has(r[key]) ? [r] : nullable ? [{ ...r, [key]: null }] : []));
  }
  return rows;
}
