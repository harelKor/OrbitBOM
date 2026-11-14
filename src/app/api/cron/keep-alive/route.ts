import { lt, sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db, schema } from "@/db";
import { cronAllowed } from "@/lib/cron";
import { saveNightlyBackup } from "@/lib/storage/backup";
import { cleanUpStorage, recountStorage } from "@/lib/storage/usage";
import { purgeTrash } from "@/lib/trash";

export const maxDuration = 300;

// Daily, from the server's orbitparts-keep-alive timer (deploy/setup.sh). Supabase pauses a free project after 7 days without
// activity; one query a day keeps it awake. It also recounts R2 storage and, above the clean-up
// line, frees space (src/config/storage.ts), and forgets Recent actions members closed more than
// two weeks ago (the list only shows the last 7 days), sync log rows older than two weeks and
// Recently deleted entries older than 30 days (with their files). First it saves the nightly backup of the
// BOM and inventory to R2 (src/lib/storage/backup.ts). Any step that fails makes the answer a
// 500, so the timer's curl -f fails and `systemctl --failed` shows it; the others still run.
const failed = (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) });

export async function GET(request: NextRequest) {
  if (!cronAllowed(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const {
    rows: [row],
  } = await db.execute<{ members: number }>(sql`select count(*)::int as members from members`);
  const backup = await saveNightlyBackup().catch(failed);
  const storage = await recountStorage()
    .then(async (count) => ({ ...count, cleanUp: await cleanUpStorage() }))
    .catch(failed);
  const dismissed = await db
    .delete(schema.dismissedActions)
    .where(lt(schema.dismissedActions.at, sql`now() - interval '14 days'`))
    .then((r) => r.rowCount ?? 0)
    .catch(failed);
  // The background refresh prunes the sync log too, but nothing schedules it at the moment.
  const syncJobs = await db
    .delete(schema.syncJobs)
    .where(lt(schema.syncJobs.startedAt, sql`now() - interval '14 days'`))
    .then((r) => r.rowCount ?? 0)
    .catch(failed);
  const trashPurged = await purgeTrash().catch(failed);
  const steps = { backup, storage, dismissedPruned: dismissed, syncJobsPruned: syncJobs, trashPurged };
  const errors = Object.entries(steps).filter(([, v]) => !!v && typeof v === "object" && "error" in v).map(([k]) => k);
  if (errors.length) console.error("keep-alive: failed steps", errors.join(", "), JSON.stringify(steps));
  return NextResponse.json(
    { ok: !errors.length, failed: errors, members: row?.members ?? 0, ...steps, at: new Date().toISOString() },
    { status: errors.length ? 500 : 200 },
  );
}
