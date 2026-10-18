import "server-only";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { refreshIntervalMinutes } from "@/config/refresh";
import { OnshapeError } from "@/lib/onshape/client";
import { refreshThumbnails } from "@/lib/onshape/thumbnails";
import { updateBomFromOnshape, type SyncSummary } from "./updateBom";

const { robots, syncJobs, systems } = schema;

export type RefreshResult = { systemId: string; changed: boolean; calls: number; error?: string };

// Claims a system for one check: moves last_checked_at forward only if the last check is older
// than the interval, so the cron and a member's open page never check the same system twice.
async function claim(systemId: string, intervalMinutes: number): Promise<boolean> {
  const stale = sql`now() - make_interval(mins => ${intervalMinutes})`;
  const rows = await db
    .update(systems)
    .set({ lastCheckedAt: sql`now()` })
    .where(
      and(
        eq(systems.id, systemId),
        isNotNull(systems.assemblyUrl),
        or(isNull(systems.lastCheckedAt), lt(systems.lastCheckedAt, stale)),
      ),
    )
    .returning({ id: systems.id });
  return rows.length > 0;
}

// Checks one system if it is due, and pulls its BOM (and new thumbnails) only when the Onshape
// document changed. Returns null when the system wasn't due.
export async function refreshSystem(
  systemId: string,
  memberId: string,
  deadline: number,
  intervalMinutes = refreshIntervalMinutes(),
): Promise<RefreshResult | null> {
  if (!(await claim(systemId, intervalMinutes))) return null;
  try {
    const s: SyncSummary = await updateBomFromOnshape(systemId, memberId, { force: false });
    let calls = s.calls;
    if (!s.skipped) calls += (await refreshThumbnails(systemId, memberId, deadline)).calls;
    return { systemId, changed: !s.skipped, calls };
  } catch (err) {
    if (err instanceof OnshapeError) return { systemId, changed: false, calls: 0, error: err.message };
    throw err;
  }
}

// The scheduled refresh: every due system of every active robot, on the account of the member
// who last ran Update BOM on it, until the deadline.
export async function refreshDueSystems(deadline: number): Promise<RefreshResult[]> {
  const interval = refreshIntervalMinutes();
  const due = await db
    .select({ id: systems.id, memberId: systems.refreshMemberId })
    .from(systems)
    .innerJoin(robots, eq(robots.id, systems.robotId))
    .where(
      and(
        eq(robots.archived, false),
        isNotNull(systems.assemblyUrl),
        isNotNull(systems.refreshMemberId),
        or(
          isNull(systems.lastCheckedAt),
          lt(systems.lastCheckedAt, sql`now() - make_interval(mins => ${interval})`),
        ),
      ),
    )
    .orderBy(sql`${systems.lastCheckedAt} asc nulls first`);

  const results: RefreshResult[] = [];
  for (const s of due) {
    // Leave room for a full BOM pull before Vercel's 60 s limit.
    if (Date.now() > deadline - 20_000) break;
    const r = await refreshSystem(s.id, s.memberId!, deadline, interval);
    if (r) results.push(r);
  }

  // Sync jobs are only a log; keep two weeks of it.
  await db.delete(syncJobs).where(lt(syncJobs.startedAt, sql`now() - interval '14 days'`));
  return results;
}
