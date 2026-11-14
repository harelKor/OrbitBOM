import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { DATABASE_LIMIT } from "@/config/storage";
import journal from "../../../drizzle/meta/_journal.json";
import { listObjects, storageConfigured } from "@/lib/storage/r2";

// The few checks an uptime monitor and the deploy look at (safety net, 2026-11-14). Each is one
// small query or one R2 list, so they're cheap to run every few minutes.

// What this bundle's drizzle/ expects against what the database has applied. drizzle stores each
// migration's journal `when` as created_at.
export async function migrationState() {
  const { rows } = await db.execute<{ created_at: string }>(sql`select created_at from drizzle.__drizzle_migrations`);
  const applied = new Set(rows.map((r) => Number(r.created_at)));
  const expected = new Set(journal.entries.map((e) => e.when));
  const missing = journal.entries.filter((e) => !applied.has(e.when)).map((e) => e.tag);
  const ahead = [...applied].filter((w) => !expected.has(w)).length;
  return { expected: expected.size, applied: applied.size, missing, ahead, inSync: !missing.length && !ahead };
}

// /api/ready, which deploy/release.sh waits for before keeping a new release: the database answers
// and every migration this code needs is applied. A database ahead of the code (a rollback to an
// older release) is still ready: migrations are written to suit the code before them.
export async function readiness() {
  try {
    await db.execute(sql`select 1`);
  } catch (err) {
    return { ready: false, database: false, error: err instanceof Error ? err.message : String(err) };
  }
  const migrations = await migrationState().catch(() => null);
  return { ready: !!migrations && !migrations.missing.length, database: true, missingMigrations: migrations?.missing ?? null };
}

export const BACKUP_MAX_AGE_HOURS = 26;
export const DATABASE_ALERT_SHARE = 0.8;
// The server's nightly pg_dump (deploy/backup.sh) and the app's own JSON backup (keep-alive).
export const SQL_BACKUP_PREFIX = "backups/sql/";
const JSON_BACKUP_PREFIX = "backups/orbitparts-";

async function newestAgeHours(prefix: string) {
  const list = await listObjects(prefix);
  if (!list.length) return null;
  const newest = Math.max(...list.map((o) => o.modified.getTime()));
  return Math.round(((Date.now() - newest) / 3_600_000) * 10) / 10;
}

type Check = { ok: boolean; detail: string };

// Everything an alert should fire on: database down or nearly full, migrations out of step with
// the live code, or a nightly backup missing.
export async function statusChecks(): Promise<{ ok: boolean; checks: Record<string, Check> }> {
  const checks: Record<string, Check> = {};
  const run = async (name: string, fn: () => Promise<Check>) => {
    checks[name] = await fn().catch((err) => ({ ok: false, detail: err instanceof Error ? err.message : String(err) }));
  };
  await run("database", async () => {
    const { rows } = await db.execute<{ bytes: string }>(sql`select pg_database_size(current_database())::bigint as bytes`);
    const share = Number(rows[0]?.bytes) / DATABASE_LIMIT;
    return { ok: share < DATABASE_ALERT_SHARE, detail: `${Math.round(share * 1000) / 10}% of ${DATABASE_LIMIT / 1024 ** 2} MB` };
  });
  await run("migrations", async () => {
    const m = await migrationState();
    return { ok: m.inSync, detail: m.inSync ? `${m.applied} applied` : `missing ${m.missing.join(", ") || "none"}, ${m.ahead} newer than this code` };
  });
  const backup = (prefix: string) => async (): Promise<Check> => {
    if (!storageConfigured()) return { ok: false, detail: "R2 isn't configured" };
    const age = await newestAgeHours(prefix);
    if (age === null) return { ok: false, detail: "none yet" };
    return { ok: age <= BACKUP_MAX_AGE_HOURS, detail: `newest ${age} h old` };
  };
  await run("sqlBackup", backup(SQL_BACKUP_PREFIX));
  await run("jsonBackup", backup(JSON_BACKUP_PREFIX));
  return { ok: Object.values(checks).every((c) => c.ok), checks };
}
