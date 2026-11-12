import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { statusBreakdown, type Breakdown } from "@/lib/stats";
import { isUuid } from "@/lib/uuid";
import { cachedQuery } from "./cache";

const { robots, systems, parts } = schema;

// The columns computeStatus needs.
const statusColumns = {
  systemId: parts.systemId,
  classification: parts.classification,
  quantity: parts.quantity,
  designState: parts.designState,
  preProcess: parts.preProcess,
  process1: parts.process1,
  process2: parts.process2,
  donePreprocess: parts.donePreprocess,
  doneProcess1: parts.doneProcess1,
  doneProcess2: parts.doneProcess2,
};

// Live BOM rows only: parts removed from CAD are kept but don't count.
async function statusRows(systemIds: string[]) {
  if (!systemIds.length) return [];
  return cachedQuery(db.select(statusColumns).from(parts).where(and(inArray(parts.systemId, systemIds), isNull(parts.removedFromCadAt))), ["parts"]);
}

export type RobotSummary = typeof robots.$inferSelect & { breakdown: Breakdown };

export async function listRobots(): Promise<RobotSummary[]> {
  const [all, allSystems] = await Promise.all([
    db.select().from(robots).orderBy(desc(robots.year), asc(robots.name)),
    db.select({ id: systems.id, robotId: systems.robotId }).from(systems),
  ]);
  const rows = await statusRows(allSystems.map((s) => s.id));
  const robotOf = new Map(allSystems.map((s) => [s.id, s.robotId]));
  return all.map((robot) => ({
    ...robot,
    breakdown: statusBreakdown(rows.filter((r) => robotOf.get(r.systemId!) === robot.id)),
  }));
}

export async function getRobot(robotId: string) {
  if (!isUuid(robotId)) return null;
  // The robot, its systems and their parts' statuses in one parallel round.
  const [[robot], robotSystems, rows] = await Promise.all([
    db.select().from(robots).where(eq(robots.id, robotId)).limit(1),
    db.select().from(systems).where(eq(systems.robotId, robotId)).orderBy(asc(systems.name)),
    cachedQuery(
      db
        .select(statusColumns)
        .from(parts)
        .innerJoin(systems, eq(systems.id, parts.systemId))
        .where(and(eq(systems.robotId, robotId), isNull(parts.removedFromCadAt))),
      ["parts", "systems"],
    ),
  ]);
  if (!robot) return null;
  return {
    robot,
    breakdown: statusBreakdown(rows),
    systems: robotSystems.map((system) => ({
      ...system,
      breakdown: statusBreakdown(rows.filter((r) => r.systemId === system.id)),
    })),
  };
}

export async function getSystem(robotId: string, systemId: string) {
  if (!isUuid(robotId) || !isUuid(systemId)) return null;
  const [[row], rows] = await Promise.all([
    db
      .select({ system: systems, robot: robots })
      .from(systems)
      .innerJoin(robots, eq(robots.id, systems.robotId))
      .where(and(eq(systems.id, systemId), eq(systems.robotId, robotId)))
      .limit(1),
    statusRows([systemId]),
  ]);
  if (!row) return null;
  return { ...row, breakdown: statusBreakdown(rows) };
}

// Robot → systems for pickers such as Inventory's "To BOM". Archived robots are left out.
export async function listBomTargets() {
  const rows = await db
    .select({ robotId: robots.id, robotName: robots.name, systemId: systems.id, systemName: systems.name })
    .from(robots)
    .innerJoin(systems, eq(systems.robotId, robots.id))
    .where(eq(robots.archived, false))
    .orderBy(desc(robots.year), asc(robots.name), asc(systems.name));
  const out: { id: string; name: string; systems: { id: string; name: string }[] }[] = [];
  for (const r of rows) {
    let robot = out.find((x) => x.id === r.robotId);
    if (!robot) out.push((robot = { id: r.robotId, name: r.robotName, systems: [] }));
    robot.systems.push({ id: r.systemId, name: r.systemName });
  }
  return out;
}

// Whether the robot or one of its systems has a Basepart linked (Harel, 2026-11-12): the CAD page's
// Basepart | Final toggle.
export async function basepartLinked(robotId: string): Promise<boolean> {
  if (!isUuid(robotId)) return false;
  const [[robot], [system]] = await Promise.all([
    db.select({ url: robots.basepartUrl }).from(robots).where(eq(robots.id, robotId)),
    db.select({ id: systems.id }).from(systems).where(and(eq(systems.robotId, robotId), isNotNull(systems.basepartUrl))).limit(1),
  ]);
  return !!robot?.url || !!system;
}
