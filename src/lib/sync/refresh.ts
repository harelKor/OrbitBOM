import "server-only";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { refreshIntervalMinutes } from "@/config/refresh";
import { NotConnectedError, OnshapeError, QuotaError, RateLimitError, TeamBudgetError } from "@/lib/onshape/client";
import { refreshPartData } from "@/lib/onshape/thumbnails";
import { checkSystem } from "@/lib/versions/detect";

const { robots, syncJobs, systems } = schema;

export type RefreshResult = { systemId: string; changed: boolean; calls: number; error?: string; outOfCalls?: boolean };

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

// Checks one system if it is due (plan/system-versioning.md §4): one call when the Onshape
// document didn't change; otherwise what changed is kept in the system's draft for a member to
// commit. Nothing reaches the BOM here. `changed` says a check found new changes. Returns null
// when the system wasn't due. Only the system's own refresh account is used: a check never
// borrows another member's Onshape account (it could read documents that member was never
// asked to share; the old pool fallback was removed, audit 2026-11-14).
export async function refreshSystem(
  systemId: string,
  memberId: string | null,
  deadline: number,
  intervalMinutes = refreshIntervalMinutes(),
): Promise<RefreshResult | null> {
  if (!(await claim(systemId, intervalMinutes))) return null;
  if (!memberId) return { systemId, changed: false, calls: 0, error: new NotConnectedError().message };
  if (Date.now() > deadline - 15_000) return { systemId, changed: false, calls: 0, error: "Out of time." };
  try {
    const c = await checkSystem(systemId, memberId, { force: false });
    let calls = c.calls;
    if (!c.unchanged && !c.draft) calls += (await refreshPartData(systemId, memberId)).calls;
    return { systemId, changed: !c.unchanged, calls };
  } catch (err) {
    // Out of the yearly allowance, the team's own cap or Onshape's rate limit: the other systems would only fail too.
    if (err instanceof OnshapeError) return { systemId, changed: false, calls: 0, error: err.message, outOfCalls: err instanceof QuotaError || err instanceof TeamBudgetError || err instanceof RateLimitError };
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
        // Checked on the account of the member who last ran Update BOM; systems without one
        // (nobody pulled them yet, or that member left) wait for a member's next Update BOM.
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
    // Leave room for a full BOM pull before the run's deadline.
    if (Date.now() > deadline - 20_000) break;
    // One system's failure (a database error, a bad assembly) is reported and the run goes on.
    const r = await refreshSystem(s.id, s.memberId, deadline, interval).catch(
      (err): RefreshResult => ({ systemId: s.id, changed: false, calls: 0, error: (err as Error).message || "Check failed" }),
    );
    if (r) results.push(r);
    // Out of the year's or the day's calls: the other systems would only fail too.
    if (r?.outOfCalls) break;
  }

  // Sync jobs are only a log; keep two weeks of it.
  await db.delete(syncJobs).where(lt(syncJobs.startedAt, sql`now() - interval '14 days'`));
  return results;
}
