import "server-only";
import { gzipSync } from "node:zlib";
import { desc, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { BACKUP_DAYS } from "@/config/storage";
import { deleteObject, listObjects, presignDownload, putObject, storageConfigured } from "./r2";

const { storedFiles } = schema;

export const BACKUP_PREFIX = "backups/";

// The tables a nightly backup holds: the BOM and the inventory. Members and Onshape tokens stay
// out of it.
const TABLES = {
  robots: schema.robots,
  systems: schema.systems,
  parts: schema.parts,
  partGroups: schema.partGroups,
  groupMembers: schema.groupMembers,
  merges: schema.merges,
  mergeMembers: schema.mergeMembers,
  inventoryCategories: schema.inventoryCategories,
  inventoryLocations: schema.inventoryLocations,
  inventoryConditions: schema.inventoryConditions,
  inventoryGroups: schema.inventoryGroups,
  inventoryItems: schema.inventoryItems,
};

// Every row of those tables as one gzipped JSON file, backups/orbitparts-YYYY-MM-DD.json.gz
// (a second run the same day replaces that day's file). Files older than BACKUP_DAYS go.
export async function saveNightlyBackup() {
  if (!storageConfigured()) return { skipped: "R2 isn't configured" };
  const tables = Object.fromEntries(
    await Promise.all(Object.entries(TABLES).map(async ([name, table]) => [name, await db.select().from(table)] as const)),
  );
  const at = new Date();
  const json = JSON.stringify({ app: "OrbitParts", version: 1, at: at.toISOString(), tables });
  const gz = gzipSync(json);
  const key = `${BACKUP_PREFIX}orbitparts-${at.toISOString().slice(0, 10)}.json.gz`;
  await putObject(key, gz, "application/gzip");

  const cutoff = new Date(at.getTime() - BACKUP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const old = (await listObjects(BACKUP_PREFIX)).filter((o) => {
    const day = o.key.match(/orbitparts-(\d{4}-\d{2}-\d{2})\.json\.gz$/)?.[1];
    return day && day < cutoff;
  });
  for (const o of old) await deleteObject(o.key);
  return { key, bytes: gz.byteLength, rows: Object.values(tables).reduce((n, t) => n + t.length, 0), deleted: old.length };
}

export type BackupInfo = { latest: { key: string; bytes: number; at: string } | null; count: number };

// The storage window's Backups row, from the ledger (no R2 calls).
export async function backupInfo(): Promise<BackupInfo> {
  const rows = await db
    .select({ key: storedFiles.key, bytes: storedFiles.bytes, at: storedFiles.createdAt })
    .from(storedFiles)
    .where(like(storedFiles.key, `${BACKUP_PREFIX}%`))
    .orderBy(desc(storedFiles.key));
  const [latest] = rows;
  return { latest: latest ? { key: latest.key, bytes: latest.bytes, at: latest.at.toISOString() } : null, count: rows.length };
}

export async function latestBackupUrl() {
  const { latest } = await backupInfo();
  if (!latest) return null;
  return presignDownload(latest.key, latest.key.slice(BACKUP_PREFIX.length), false);
}
