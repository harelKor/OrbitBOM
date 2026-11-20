import "server-only";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { getMachine } from "@/config/machines";
import { db, schema } from "@/db";
import { partKey } from "@/lib/model/assembly";
import type { PartFacts } from "./weight";
import { pairKey, type CheckLimits, type CheckResults, type SavedCheck } from "./types";

const { designChecks, designCheckIgnores, partWeights, parts, robots, systems, members } = schema;

// What the CAD page's Design check needs to run and show (a GET, src/app/api/robots/<id>/design-check):
// the robot's limits, what the database knows about each part for its weight, the pairs marked
// fine, and the newest saved run on this model. Database only.
export type CheckData = { limits: CheckLimits; facts: Record<string, PartFacts>; ignored: string[]; latest: SavedCheck | null };

export async function loadCheckData(robotId: string, model: "final" | "basepart"): Promise<CheckData | null> {
  const [robot] = await db.select({ limits: robots.checkLimits }).from(robots).where(eq(robots.id, robotId));
  if (!robot) return null;
  const [rows, ignores, latest] = await Promise.all([
    db
      .select({ did: parts.sourceDid, eid: parts.sourceEid, pid: parts.onshapePartId, material: parts.material, geometry: parts.geometry, process1: parts.process1, addedProcesses: parts.addedProcesses })
      .from(parts)
      .innerJoin(systems, eq(systems.id, parts.systemId))
      .where(eq(systems.robotId, robotId)),
    db.select({ pair: designCheckIgnores.pair }).from(designCheckIgnores).where(eq(designCheckIgnores.robotId, robotId)),
    db
      .select({ id: designChecks.id, model: designChecks.model, sig: designChecks.sig, results: designChecks.results, ranAt: designChecks.createdAt, ranBy: members.name })
      .from(designChecks)
      .leftJoin(members, eq(members.id, designChecks.ranBy))
      .where(and(eq(designChecks.robotId, robotId), eq(designChecks.model, model)))
      .orderBy(desc(designChecks.createdAt))
      .limit(1),
  ]);
  const facts: Record<string, PartFacts> = {};
  for (const r of rows) {
    if (!r.did || !r.eid || !r.pid) continue;
    const machines = [r.process1, ...r.addedProcesses.map((p) => p.machine)].filter((m): m is string => !!m);
    const printed = machines.some((m) => getMachine(m)?.kind === "print");
    facts[partKey(r.did, r.eid, r.pid)] = { material: r.material, onshapeMaterial: r.geometry?.onshapeMaterial ?? null, printed, setG: null, machines };
  }
  const keys = Object.keys(facts);
  const weights = keys.length ? await db.select({ key: partWeights.key, grams: partWeights.grams }).from(partWeights).where(inArray(partWeights.key, keys)) : [];
  for (const w of weights) facts[w.key].setG = w.grams;
  const l = latest[0];
  return {
    limits: robot.limits ?? {},
    facts,
    ignored: ignores.map((i) => i.pair),
    latest: l ? { id: l.id, model: l.model === "basepart" ? "basepart" : "final", sig: l.sig, ranAt: l.ranAt.toISOString(), ranBy: l.ranBy, results: l.results } : null,
  };
}

// Keeps the newest few runs per robot and model (a run is a few hundred kB at most).
const KEEP = 3;

export async function saveCheck(robotId: string, model: "final" | "basepart", sig: string, results: CheckResults, memberId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(designChecks).values({ robotId, model, sig, results, ranBy: memberId }).returning({ id: designChecks.id });
    const keep = await tx
      .select({ id: designChecks.id })
      .from(designChecks)
      .where(and(eq(designChecks.robotId, robotId), eq(designChecks.model, model)))
      .orderBy(desc(designChecks.createdAt))
      .limit(KEEP);
    await tx.delete(designChecks).where(and(eq(designChecks.robotId, robotId), eq(designChecks.model, model), notInArray(designChecks.id, keep.map((k) => k.id))));
    return row.id;
  });
}

// Limits as typed on the page: numbers above zero or nothing, the up axis, known systems only.
export function cleanLimits(raw: unknown, systemIds: string[]): CheckLimits {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, max: number) => {
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    return Number.isFinite(n) && n > 0 && n <= max ? Math.round(n * 100) / 100 : null;
  };
  const known = new Set(systemIds);
  const budgets: Record<string, number> = {};
  if (o.budgets && typeof o.budgets === "object") {
    for (const [id, v] of Object.entries(o.budgets as Record<string, unknown>)) {
      const n = num(v, 1000);
      if (known.has(id) && n != null) budgets[id] = n;
    }
  }
  return {
    weightKg: num(o.weightKg, 1000),
    perimeterMm: num(o.perimeterMm, 100000),
    heightMm: num(o.heightMm, 100000),
    frameZoneMm: num(o.frameZoneMm, 100000),
    up: o.up === "x" || o.up === "y" ? o.up : "z",
    exclude: Array.isArray(o.exclude) ? o.exclude.filter((id): id is string => typeof id === "string" && known.has(id)) : [],
    budgets,
  };
}

export async function setLimits(robotId: string, raw: unknown) {
  const ids = await db.select({ id: systems.id }).from(systems).where(eq(systems.robotId, robotId));
  const limits = cleanLimits(raw, ids.map((s) => s.id));
  await db.update(robots).set({ checkLimits: limits }).where(eq(robots.id, robotId));
  return limits;
}

export async function setPartWeight(key: string, grams: number | null, memberId: string) {
  if (grams == null) return db.delete(partWeights).where(eq(partWeights.key, key));
  return db
    .insert(partWeights)
    .values({ key, grams, setBy: memberId })
    .onConflictDoUpdate({ target: partWeights.key, set: { grams, setBy: memberId, updatedAt: new Date() } });
}

export async function setIgnored(robotId: string, a: string, b: string, ignored: boolean, memberId: string) {
  return setIgnoredId(robotId, pairKey(a, b), ignored, memberId);
}

// A finding marked fine, by its id (findingId in types.ts), or an overlapping pair by pairKey.
export async function setIgnoredId(robotId: string, pair: string, ignored: boolean, memberId: string) {
  if (!ignored) return db.delete(designCheckIgnores).where(and(eq(designCheckIgnores.robotId, robotId), eq(designCheckIgnores.pair, pair)));
  return db.insert(designCheckIgnores).values({ robotId, pair, createdBy: memberId }).onConflictDoNothing();
}

// The newest run with what the AI write-up needs (robot name, system names), and saving the
// write-up into it, so the team sees it with the run.
export async function latestRun(robotId: string, model: "final" | "basepart") {
  const [robot] = await db.select({ name: robots.name, limits: robots.checkLimits }).from(robots).where(eq(robots.id, robotId));
  if (!robot) return null;
  const [run] = await db
    .select({ id: designChecks.id, results: designChecks.results })
    .from(designChecks)
    .where(and(eq(designChecks.robotId, robotId), eq(designChecks.model, model)))
    .orderBy(desc(designChecks.createdAt))
    .limit(1);
  if (!run) return null;
  const sys = await db.select({ id: systems.id, name: systems.name }).from(systems).where(eq(systems.robotId, robotId));
  return { robot: robot.name, limits: robot.limits ?? {}, run, systems: Object.fromEntries(sys.map((s) => [s.id, s.name])) };
}

export async function saveReview(checkId: string, results: CheckResults) {
  await db.update(designChecks).set({ results }).where(eq(designChecks.id, checkId));
}
