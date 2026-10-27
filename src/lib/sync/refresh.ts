import "server-only";
import { and, asc, eq, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { refreshIntervalMinutes } from "@/config/refresh";
import { BudgetError, DAILY_CALL_BUDGET, NotConnectedError, OnshapeError } from "@/lib/onshape/client";
import { missingAssemblyThumbnails, refreshThumbnails } from "@/lib/onshape/thumbnails";
import { checkSystem } from "@/lib/versions/detect";

const { members, onshapeTokens, robots, syncJobs, systems } = schema;

// A pool account is only borrowed while it has this many calls left today, so a background
// check never spends a member's last calls.
const POOL_RESERVE = 200;
const MAX_ACCOUNTS = 3;

// Other members' connected Onshape accounts with calls to spare today, least used first.
async function poolAccounts(exclude: string | null): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({ id: onshapeTokens.memberId })
    .from(onshapeTokens)
    .innerJoin(members, eq(members.id, onshapeTokens.memberId))
    .where(
      and(
        eq(members.onshapeConnected, true),
        exclude ? ne(onshapeTokens.memberId, exclude) : undefined,
        or(
          isNull(onshapeTokens.callsDay),
          ne(onshapeTokens.callsDay, today),
          lt(onshapeTokens.callsToday, DAILY_CALL_BUDGET - POOL_RESERVE),
        ),
      ),
    )
    .orderBy(asc(sql`case when ${onshapeTokens.callsDay} = ${today} then ${onshapeTokens.callsToday} else 0 end`))
    .limit(MAX_ACCOUNTS);
  return rows.map((r) => r.id);
}

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

// Checks one system if it is due (plan/system-versioning.md §4): one call when the Onshape
// document didn't change; otherwise what changed is kept in the system's draft for a member to
// commit. Nothing reaches the BOM here. `changed` says a check found new changes. Returns null
// when the system wasn't due. When the account is missing, disconnected or out of calls for the
// day, the check moves to another member's connected account, which becomes the system's
// refresh account so later checks start there.
export async function refreshSystem(
  systemId: string,
  memberId: string | null,
  deadline: number,
  intervalMinutes = refreshIntervalMinutes(),
): Promise<RefreshResult | null> {
  if (!(await claim(systemId, intervalMinutes))) return null;
  const accounts = memberId ? [memberId] : [];
  let lastError = new NotConnectedError().message;
  for (let i = 0; i < MAX_ACCOUNTS + 1; i++) {
    if (i === accounts.length) accounts.push(...(await poolAccounts(memberId)).filter((a) => !accounts.includes(a)));
    const account = accounts[i];
    if (!account || Date.now() > deadline - 15_000) break;
    try {
      const c = await checkSystem(systemId, account, { force: false });
      let calls = c.calls;
      if (c.unchanged) calls += await missingAssemblyThumbnails(systemId, account);
      else if (!c.draft) calls += (await refreshThumbnails(systemId, account, deadline)).calls;
      if (account !== memberId) await db.update(systems).set({ refreshMemberId: account }).where(eq(systems.id, systemId));
      return { systemId, changed: !c.unchanged, calls };
    } catch (err) {
      if (err instanceof NotConnectedError || err instanceof BudgetError) {
        lastError = err.message;
        continue;
      }
      if (err instanceof OnshapeError) return { systemId, changed: false, calls: 0, error: err.message };
      throw err;
    }
  }
  return { systemId, changed: false, calls: 0, error: lastError };
}

// The scheduled refresh: every due system of every active robot, on the account of the member
// who last ran Update BOM on it (or, when that account can't, another connected member's), until
// the deadline.
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
        // Systems nobody has pulled yet wait for a member's first Update BOM. One whose refresh
        // account is gone (the member left) still has its parts from Onshape and keeps going.
        or(
          isNotNull(systems.refreshMemberId),
          sql`exists (select 1 from ${schema.parts} where ${schema.parts.systemId} = ${systems.id} and not ${schema.parts.isManual})`,
        ),
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
    const r = await refreshSystem(s.id, s.memberId, deadline, interval);
    if (r) results.push(r);
  }

  // Sync jobs are only a log; keep two weeks of it.
  await db.delete(syncJobs).where(lt(syncJobs.startedAt, sql`now() - interval '14 days'`));
  return results;
}
