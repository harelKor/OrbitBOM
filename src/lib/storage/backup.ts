import "server-only";
import { gzipSync } from "node:zlib";
import { desc, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { BACKUP_DAYS } from "@/config/storage";
import { deleteObject, listObjects, presignDownload, putObject, storageConfigured } from "./r2";

const { storedFiles } = schema;

export const BACKUP_PREFIX = "backups/";

// The tables a nightly backup holds: the BOM (with which files and drawings belong to which
// part), the material list from Settings, and the inventory with its stock moves. Members and
// Onshape tokens stay out of it.
export const BACKUP_TABLES = {
  robots: schema.robots,
  systems: schema.systems,
  parts: schema.parts,
  partFiles: schema.partFiles,
  partDrawings: schema.partDrawings,
  partGroups: schema.partGroups,
  groupMembers: schema.groupMembers,
  groupFiles: schema.groupFiles,
  merges: schema.merges,
  mergeMembers: schema.mergeMembers,
  materialGroups: schema.materialGroups,
  materialColors: schema.materialColors,
  inventoryCategories: schema.inventoryCategories,
  inventoryLocations: schema.inventoryLocations,
  inventoryConditions: schema.inventoryConditions,
  baseMaterials: schema.baseMaterials,
  bores: schema.bores,
  inventoryGroups: schema.inventoryGroups,
  inventoryItems: schema.inventoryItems,
  inventoryMoves: schema.inventoryMoves,
};

// Every row of those tables as one gzipped JSON file, backups/orbitparts-YYYY-MM-DD.json.gz
// (a second run the same day replaces that day's file). Files older than BACKUP_DAYS go.
// `label` names an extra copy instead (orbitparts-YYYY-MM-DD-<label>.json.gz), such as the one a
// restore saves first.
export async function saveNightlyBackup(label?: string) {
  if (!storageConfigured()) return { skipped: "R2 isn't configured" };
  // One snapshot: every table as it was at the same moment, so a part and its stock moves never
  // disagree (20 separate reads could straddle a save). Read only, so it can't block writers.
  const tables = await db.transaction(
    async (tx) => {
      const out: Record<string, unknown[]> = {};
      for (const [name, table] of Object.entries(BACKUP_TABLES)) out[name] = await tx.select().from(table);
      return out;
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const at = new Date();
  const json = JSON.stringify({ app: "OrbitParts", version: 1, at: at.toISOString(), tables });
  const gz = gzipSync(json);
  const key = `${BACKUP_PREFIX}orbitparts-${at.toISOString().slice(0, 10)}${label ? `-${label}` : ""}.json.gz`;
  await putObject(key, gz, "application/gzip");

  const cutoff = new Date(at.getTime() - BACKUP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const old = (await listObjects(BACKUP_PREFIX)).filter((o) => {
    const day = o.key.match(/orbitparts-(\d{4}-\d{2}-\d{2})[^/]*\.json\.gz$/)?.[1];
    return day && day < cutoff;
  });
  for (const o of old) await deleteObject(o.key);
  return { key, bytes: gz.byteLength, rows: Object.values(tables).reduce((n, t) => n + t.length, 0), deleted: old.length };
}

export type BackupFile = { key: string; name: string; bytes: number; at: string };
export type BackupInfo = { latest: BackupFile | null; count: number; all: BackupFile[] };

// The storage window's Backups row, from the ledger (no R2 calls). Only the app's own JSON
// backups: the server's nightly pg_dump files (backups/sql/, deploy/backup.sh) are restored by
// hand (docs/runbook.md), not from Settings.
export async function backupInfo(): Promise<BackupInfo> {
  const rows = await db
    .select({ key: storedFiles.key, bytes: storedFiles.bytes, at: storedFiles.createdAt })
    .from(storedFiles)
    .where(like(storedFiles.key, `${BACKUP_PREFIX}orbitparts-%`))
    .orderBy(desc(storedFiles.key));
  // Newest first by when it was saved (a restore's safety copy sorts after that day's nightly one by name).
  const all = rows
    .map((r) => ({ key: r.key, name: r.key.slice(BACKUP_PREFIX.length), bytes: r.bytes, at: r.at.toISOString() }))
    .sort((a, b) => b.at.localeCompare(a.at));
  return { latest: all[0] ?? null, count: all.length, all };
}

export async function latestBackupUrl() {
  const { latest } = await backupInfo();
  if (!latest) return null;
  return presignDownload(latest.key, latest.name, false);
}

export const isBackupKey = (key: string) => /^backups\/orbitparts-[\w-]+\.json\.gz$/.test(key);

export async function backupUrl(key: string) {
  if (!isBackupKey(key)) return null;
  return presignDownload(key, key.slice(BACKUP_PREFIX.length), false);
}
