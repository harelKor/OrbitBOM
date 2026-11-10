import "server-only";
import { and, eq, isNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { assemblySteps, assemblySubs, assemblyTicks, systems, type StepCamera } from "@/db/schema";
import { deleteObject } from "@/lib/storage/r2";

// Writing the Assembly page's steps (CAD, the action checks `instruct`) and ticking them (any
// member with a team, `work`). Plan: plan/assembly-guides.md.
export class StepError extends Error {}

export const STILL_PATH = /^assembly-stills\/[0-9a-f-]{36}\.jpg$/;
const CODE = /^\d{2}$/;
const MAX_TITLE = 200;
const MAX_BODY = 4000;
const MAX_PARTS = 2000;

export type StepInput = {
  id?: string | null; // null: a new step
  systemId: string;
  subCode: string | null; // the column it is in: the system's own (null) or a sub-assembly's
  kind: "step" | "sub";
  subRef: string | null; // kind "sub": the sub-assembly it opens
  title: string;
  body: string;
  critical: boolean;
  partKeys: string[];
  camera: StepCamera | null;
  imageKey: string | null; // a still already uploaded (/api/assembly-stills), or the one it has
  before?: string | null; // a new step goes before this one; at the end when missing
};

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const vec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(num);
export function cleanCamera(c: unknown): StepCamera | null {
  if (!c || typeof c !== "object") return null;
  const { target, dir, half, projection } = c as Record<string, unknown>;
  if (!vec(target) || !vec(dir) || !num(half) || (half as number) <= 0 || (projection !== "ortho" && projection !== "perspective")) return null;
  return { target: target as StepCamera["target"], dir: dir as StepCamera["dir"], half: half as number, projection };
}

async function systemOf(robotId: string, systemId: string) {
  const [s] = await db.select({ id: systems.id }).from(systems).where(and(eq(systems.id, systemId), eq(systems.robotId, robotId)));
  if (!s) throw new StepError("That system isn't on this robot.");
}

const sameColumn = (systemId: string, subCode: string | null) =>
  and(eq(assemblySteps.systemId, systemId), subCode ? eq(assemblySteps.subCode, subCode) : isNull(assemblySteps.subCode));

export async function saveStep(robotId: string, memberId: string, input: StepInput): Promise<{ id: string }> {
  await systemOf(robotId, input.systemId);
  if (input.subCode !== null && !CODE.test(input.subCode)) throw new StepError("Unknown sub-assembly.");
  if (input.kind !== "step" && input.kind !== "sub") throw new StepError("Unknown step kind.");
  if (input.kind === "sub" && (input.subCode !== null || !input.subRef || !CODE.test(input.subRef))) throw new StepError("A sub-assembly step goes in its system's column.");
  const title = String(input.title ?? "").trim().slice(0, MAX_TITLE);
  const body = String(input.body ?? "").slice(0, MAX_BODY);
  if (input.kind === "step" && !title) throw new StepError("Give the step a title.");
  const partKeys = [...new Set((Array.isArray(input.partKeys) ? input.partKeys : []).filter((k): k is string => typeof k === "string" && k.length < 300))].slice(0, MAX_PARTS);
  if (input.imageKey !== null && !STILL_PATH.test(input.imageKey)) throw new StepError("That picture didn't upload.");
  const values = {
    kind: input.kind,
    subRef: input.kind === "sub" ? input.subRef : null,
    title,
    body,
    critical: !!input.critical,
    partKeys,
    camera: cleanCamera(input.camera),
    imageKey: input.imageKey,
    updatedAt: new Date(),
  };

  if (input.id) {
    return db.transaction(async (tx) => {
      const [old] = await tx.select().from(assemblySteps).where(and(eq(assemblySteps.id, input.id!), eq(assemblySteps.systemId, input.systemId))).for("update");
      if (!old) throw new StepError("That step is gone. Reload the page.");
      await tx.update(assemblySteps).set(values).where(eq(assemblySteps.id, old.id));
      // New parts make it a different step: it isn't built any more (Harel, 2026-11-10).
      const before = [...old.partKeys].sort().join("\n");
      if (before !== [...partKeys].sort().join("\n")) await tx.delete(assemblyTicks).where(eq(assemblyTicks.stepId, old.id));
      if (old.imageKey && old.imageKey !== values.imageKey) await deleteObject(old.imageKey).catch(() => {});
      return { id: old.id };
    });
  }

  return db.transaction(async (tx) => {
    // One writer per column at a time, so two new steps don't take the same place.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`assembly:${input.systemId}:${input.subCode ?? ""}`}))`);
    let position: number;
    const at = input.before ? (await tx.select({ p: assemblySteps.position }).from(assemblySteps).where(and(eq(assemblySteps.id, input.before), sameColumn(input.systemId, input.subCode))))[0] : undefined;
    if (at) {
      position = at.p;
      await tx
        .update(assemblySteps)
        .set({ position: sql`${assemblySteps.position} + 1` })
        .where(and(sameColumn(input.systemId, input.subCode), sql`${assemblySteps.position} >= ${at.p}`));
    } else {
      const [m] = await tx.select({ p: max(assemblySteps.position) }).from(assemblySteps).where(sameColumn(input.systemId, input.subCode));
      position = (m?.p ?? -1) + 1;
    }
    const [row] = await tx
      .insert(assemblySteps)
      .values({ ...values, systemId: input.systemId, subCode: input.subCode, position, createdBy: memberId })
      .returning({ id: assemblySteps.id });
    return row;
  });
}

// The column's steps in this order (every id must be one of its steps).
export async function reorderSteps(robotId: string, systemId: string, subCode: string | null, ids: string[]) {
  await systemOf(robotId, systemId);
  await db.transaction(async (tx) => {
    const rows = await tx.select({ id: assemblySteps.id }).from(assemblySteps).where(sameColumn(systemId, subCode)).for("update");
    const have = new Set(rows.map((r) => r.id));
    if (ids.length !== have.size || !ids.every((id) => have.has(id))) throw new StepError("The steps changed meanwhile. Reload the page.");
    for (let i = 0; i < ids.length; i++) await tx.update(assemblySteps).set({ position: i }).where(eq(assemblySteps.id, ids[i]));
  });
}

export async function deleteStep(robotId: string, id: string) {
  const [s] = await db
    .select({ id: assemblySteps.id, imageKey: assemblySteps.imageKey })
    .from(assemblySteps)
    .innerJoin(systems, eq(systems.id, assemblySteps.systemId))
    .where(and(eq(assemblySteps.id, id), eq(systems.robotId, robotId)));
  if (!s) return;
  await db.delete(assemblySteps).where(eq(assemblySteps.id, s.id));
  if (s.imageKey) await deleteObject(s.imageKey).catch(() => {});
}

// A sub-assembly's name; blank goes back to "Sub-assembly 420".
export async function nameSub(robotId: string, systemId: string, code: string, name: string) {
  await systemOf(robotId, systemId);
  if (!CODE.test(code)) throw new StepError("Unknown sub-assembly.");
  const clean = name.trim().slice(0, 80);
  if (!clean) return void (await db.delete(assemblySubs).where(and(eq(assemblySubs.systemId, systemId), eq(assemblySubs.code, code))));
  await db
    .insert(assemblySubs)
    .values({ systemId, code, name: clean })
    .onConflictDoUpdate({ target: [assemblySubs.systemId, assemblySubs.code], set: { name: clean } });
}

export async function tickStep(robotId: string, memberId: string, id: string, done: boolean) {
  const [s] = await db
    .select({ id: assemblySteps.id })
    .from(assemblySteps)
    .innerJoin(systems, eq(systems.id, assemblySteps.systemId))
    .where(and(eq(assemblySteps.id, id), eq(systems.robotId, robotId)));
  if (!s) throw new StepError("That step is gone. Reload the page.");
  if (done) await db.insert(assemblyTicks).values({ stepId: id, memberId }).onConflictDoNothing();
  else await db.delete(assemblyTicks).where(eq(assemblyTicks.stepId, id));
}
