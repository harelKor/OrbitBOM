import "server-only";
import { and, eq, gt, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { arrivalPage } from "@/lib/seen";
import { cached } from "./cache";

const { parts, systems, pageSeen } = schema;

// Arrivals older than this don't glow anymore, so the side panel's read stays small.
const GLOW_DAYS = 30;

// When the member last opened each tracked page (src/lib/seen.ts).
export async function listSeen(memberId: string): Promise<Record<string, string>> {
  const rows = await db.select({ page: pageSeen.page, at: pageSeen.seenAt }).from(pageSeen).where(eq(pageSeen.memberId, memberId));
  return Object.fromEntries(rows.map((r) => [r.page, r.at.toISOString()]));
}

// When the member last opened one page, or null the first time.
export async function getSeenAt(memberId: string, page: string): Promise<string | null> {
  const [row] = await db.select({ at: pageSeen.seenAt }).from(pageSeen).where(and(eq(pageSeen.memberId, memberId), eq(pageSeen.page, page)));
  return row?.at.toISOString() ?? null;
}

export async function markSeen(memberId: string, page: string) {
  const now = new Date();
  await db.insert(pageSeen).values({ memberId, page, seenAt: now }).onConflictDoUpdate({ target: [pageSeen.memberId, pageSeen.page], set: { seenAt: now } });
}

// The newest arrival still listed on each page, for the side panel and home boxes: "fab:<robot>"
// and, per Shop Fab tab, "fab:<robot>@<machine>"; the printer, factory and COTS pages as they are.
// Reads only parts that arrived in the last GLOW_DAYS days. A part the member changed last is left
// out: they've seen it.
export async function listNewest(memberId: string): Promise<Record<string, string>> {
  const since = new Date(Date.now() - GLOW_DAYS * 86_400_000);
  // The layout reads this on every navigation and save: the team's rows stay in the server's
  // memory until a part or system changes, and each member's view is filtered from them here.
  // The window is cut again below, since a kept list can be older than today's cut-off.
  const rows = await cached("arrivals", ["parts", "systems"], () => loadArrivals(new Date(Date.now() - GLOW_DAYS * 86_400_000)));
  const newest: Record<string, string> = {};
  const keep = (key: string, at: Date) => {
    if (!newest[key] || newest[key] < at.toISOString()) newest[key] = at.toISOString();
  };
  for (const r of rows) {
    if (!r.stageAt || r.stageAt <= since || r.by === memberId) continue;
    const where = arrivalPage(r, r.robotId);
    if (!where) continue;
    keep(where.page, r.stageAt);
    if (where.machine) keep(`${where.page}@${where.machine}`, r.stageAt);
  }
  return newest;
}

function loadArrivals(since: Date) {
  return db
    .select({
      stageAt: parts.stageAt,
      by: parts.lastModifiedBy,
      robotId: systems.robotId,
      classification: parts.classification,
      quantity: parts.quantity,
      designState: parts.designState,
      process1: parts.process1,
      doneProcess1: parts.doneProcess1,
      addedProcesses: parts.addedProcesses,
      qaHeld: parts.qaHeld,
      cotsQa: parts.cotsQa,
    })
    .from(parts)
    .leftJoin(systems, eq(systems.id, parts.systemId))
    .where(and(isNotNull(parts.stageAt), gt(parts.stageAt, since), isNull(parts.removedFromCadAt)));
}
