import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { KEEP_PREVIEW_VERSIONS, STORAGE_CLEAN_UP, STORAGE_CLEAN_UP_TO } from "@/config/storage";
import { partModelFile } from "@/lib/model/part";
import { versionLabel } from "@/lib/versions/label";
import { backupInfo, type BackupInfo } from "./backup";
import { kindOf, type StoredKind } from "./ledger";
import { deleteObject, listObjects, storageConfigured } from "./r2";

const { onshapeCache, partVersions, parts, robots, storedFiles, systems, systemVersions } = schema;

// The nightly recount (plan/system-versioning.md §5): the ledger takes the bucket's real list,
// which adds what the browser uploaded directly and drops what is gone. A version a preview was
// counted under is kept.
export async function recountStorage() {
  if (!storageConfigured()) return { files: 0, bytes: 0 };
  const listed = await listObjects();
  const keys = new Set(listed.map((o) => o.key));
  const known = await db.select({ key: storedFiles.key }).from(storedFiles);
  const gone = known.filter((k) => !keys.has(k.key)).map((k) => k.key);
  for (let i = 0; i < gone.length; i += 500) await db.delete(storedFiles).where(inArray(storedFiles.key, gone.slice(i, i + 500)));
  for (let i = 0; i < listed.length; i += 500) {
    await db
      .insert(storedFiles)
      .values(listed.slice(i, i + 500).map((o) => ({ key: o.key, bytes: o.bytes, kind: kindOf(o.key), createdAt: o.modified })))
      .onConflictDoUpdate({ target: storedFiles.key, set: { bytes: sql`excluded.bytes`, kind: sql`excluded.kind` } });
  }
  return { files: listed.length, bytes: listed.reduce((n, o) => n + o.bytes, 0) };
}

export type VersionUsage = { id: string; label: string; name: string | null; at: string | null; bytes: number; files: number; protected: boolean };
export type SystemUsage = { id: string; name: string; robotName: string; bytes: number; versions: VersionUsage[] };
export type StorageUsage = {
  total: number;
  byKind: Partial<Record<StoredKind, number>>;
  database: number;
  systems: SystemUsage[];
  unassigned: number; // previews of drafts that were replaced
  backups: BackupInfo;
};

// The storage window: everything comes from the database (the ledger), no R2 calls.
export async function storageUsage(): Promise<StorageUsage> {
  const [kinds, byVersion, versions, [dbSize], keep, backups] = await Promise.all([
    db
      .select({ kind: storedFiles.kind, bytes: sql<number>`coalesce(sum(${storedFiles.bytes}), 0)::bigint` })
      .from(storedFiles)
      .groupBy(storedFiles.kind),
    db
      .select({ versionId: storedFiles.versionId, bytes: sql<number>`sum(${storedFiles.bytes})::bigint`, files: sql<number>`count(*)::int` })
      .from(storedFiles)
      .where(eq(storedFiles.kind, "preview"))
      .groupBy(storedFiles.versionId),
    db
      .select({ v: systemVersions, systemName: systems.name, robotName: robots.name })
      .from(systemVersions)
      .innerJoin(systems, eq(systems.id, systemVersions.systemId))
      .innerJoin(robots, eq(robots.id, systems.robotId))
      .where(eq(systemVersions.state, "committed"))
      .orderBy(asc(robots.name), asc(systems.name), desc(systemVersions.seq)),
    db.execute<{ size: number }>(sql`select pg_database_size(current_database())::bigint as size`).then((r) => r.rows),
    protectedVersions(),
    backupInfo(),
  ]);
  const size = new Map(byVersion.map((v) => [v.versionId, { bytes: Number(v.bytes), files: v.files }]));
  const out = new Map<string, SystemUsage>();
  for (const { v, systemName, robotName } of versions) {
    const s = out.get(v.systemId) ?? { id: v.systemId, name: systemName, robotName, bytes: 0, versions: [] };
    const u = size.get(v.id) ?? { bytes: 0, files: 0 };
    s.bytes += u.bytes;
    s.versions.push({ id: v.id, label: versionLabel(v), name: v.name, at: v.committedAt?.toISOString() ?? null, ...u, protected: keep.has(v.id) });
    out.set(v.systemId, s);
  }
  const committed = new Set(versions.map((v) => v.v.id));
  const unassigned = byVersion.filter((v) => !v.versionId || !committed.has(v.versionId)).reduce((n, v) => n + Number(v.bytes), 0);
  const byKind = Object.fromEntries(kinds.map((k) => [k.kind, Number(k.bytes)]));
  return {
    total: kinds.reduce((n, k) => n + Number(k.bytes), 0),
    byKind,
    database: Number(dbSize?.size ?? 0),
    systems: [...out.values()].sort((a, b) => b.bytes - a.bytes),
    unassigned,
    backups,
  };
}

// Versions whose previews clean-up never deletes: each system's newest few, any version a part
// is on, versions a member named, and drafts.
async function protectedVersions(): Promise<Set<string>> {
  const [ranked, pointed, named] = await Promise.all([
    db
      .select({ id: systemVersions.id, rank: sql<number>`row_number() over (partition by ${systemVersions.systemId} order by ${systemVersions.seq} desc nulls first)` })
      .from(systemVersions),
    db
      .selectDistinct({ id: partVersions.versionId })
      .from(parts)
      .innerJoin(partVersions, eq(partVersions.id, parts.versionRowId)),
    db
      .select({ id: systemVersions.id })
      .from(systemVersions)
      .where(and(isNotNull(systemVersions.name), sql`${systemVersions.name} <> 'Baseline'`)),
  ]);
  return new Set([...ranked.filter((r) => Number(r.rank) <= KEEP_PREVIEW_VERSIONS).map((r) => r.id), ...pointed.map((r) => r.id), ...named.map((r) => r.id)]);
}

// Files nothing uses any more: robot-model Part Studio files no built or building model lists,
// and part meshes of an older revision or a deleted part. All of them are re-made from Onshape
// when needed.
async function unusedFiles() {
  const [files, models, partRows] = await Promise.all([
    db
      .select({ key: storedFiles.key, bytes: storedFiles.bytes, kind: storedFiles.kind })
      .from(storedFiles)
      // A day old at least, so a model being built right now keeps its new files.
      .where(and(inArray(storedFiles.kind, ["studio", "part"]), lt(storedFiles.createdAt, new Date(Date.now() - 86_400_000))))
      .orderBy(asc(storedFiles.createdAt)),
    db.select({ payload: sql<string>`${onshapeCache.payload}::text` }).from(onshapeCache).where(sql`${onshapeCache.key} like 'robot-model:%'`),
    db.select({ id: parts.id, thumbnailRev: parts.thumbnailRev }).from(parts),
  ]);
  const inModels = new Set(models.flatMap((m) => m.payload.match(/models\/studios\/[^"\\]+/g) ?? []));
  const current = new Set(partRows.map(partModelFile));
  return files.filter((f) => (f.kind === "studio" ? !inModels.has(f.key) : !current.has(f.key)));
}

async function remove(files: { key: string; bytes: number }[]) {
  let freed = 0;
  for (let i = 0; i < files.length; i += 8) {
    const batch = files.slice(i, i + 8);
    const done = await Promise.allSettled(batch.map((f) => deleteObject(f.key)));
    done.forEach((r, j) => r.status === "fulfilled" && (freed += batch[j].bytes));
  }
  return freed;
}

// Auto clean-up, above STORAGE_CLEAN_UP down to STORAGE_CLEAN_UP_TO (or `force` to a target):
// unused files first, then the 3D previews of versions that aren't protected, oldest first.
// Revert and fab never need these files; a preview is re-made from Onshape when opened.
export async function cleanUpStorage(opts: { force?: boolean; target?: number; deadline?: number } = {}) {
  const deadline = opts.deadline ?? Date.now() + 240_000;
  const [{ total }] = await db.select({ total: sql<number>`coalesce(sum(${storedFiles.bytes}), 0)::bigint` }).from(storedFiles);
  let used = Number(total);
  if (!opts.force && used <= STORAGE_CLEAN_UP) return { freed: 0, files: 0 };
  const target = opts.target ?? STORAGE_CLEAN_UP_TO;
  let freed = 0;
  let count = 0;
  const take = async (files: { key: string; bytes: number }[]) => {
    for (const f of files) {
      if (used <= target || Date.now() > deadline) return;
      const n = await remove([f]);
      if (n) count++;
      freed += n;
      used -= n;
    }
  };
  await take(await unusedFiles());
  if (used > target) {
    const keep = await protectedVersions();
    const previews = await db
      .select({ key: storedFiles.key, bytes: storedFiles.bytes, versionId: storedFiles.versionId })
      .from(storedFiles)
      .where(eq(storedFiles.kind, "preview"))
      .orderBy(asc(storedFiles.createdAt));
    await take(previews.filter((p) => !p.versionId || !keep.has(p.versionId)));
  }
  return { freed, files: count };
}

// The storage window's Delete: a version's 3D previews. The version itself stays, and so does
// Revert; its Before → After is re-made from Onshape when someone opens it.
export async function deleteVersionPreviews(versionId: string) {
  const files = await db.select({ key: storedFiles.key, bytes: storedFiles.bytes }).from(storedFiles).where(eq(storedFiles.versionId, versionId));
  return { freed: await remove(files), files: files.length };
}

// Storage used, for the dashboard box (one query).
export async function storageTotal(): Promise<number> {
  const [{ total }] = await db.select({ total: sql<number>`coalesce(sum(${storedFiles.bytes}), 0)::bigint` }).from(storedFiles);
  return Number(total);
}
