import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ModelKind } from "@/db/schema";

// Every version's 3D model (plan/cad-versions.md, Harel 2026-11-17): a group's plan read at a fixed
// Onshape state (a version or a microversion) never changes, so it is kept under that state. The
// model build and Update CAD's commit write here; snapshots.ts reads it for the version tree.

export type FrozenRef = { wvm: "v" | "m"; wvmid: string };
type Plan = { jobs: { key: string }[]; placements: unknown[]; names: Record<string, string> };

export const isFrozen = (ref: { wvm: string }): ref is FrozenRef => ref.wvm === "v" || ref.wvm === "m";
export const snapKey = (kind: ModelKind, src: { did: string; eid?: string }, ref: FrozenRef) => `${kind}|${src.did}|${src.eid ?? ""}|${ref.wvm}:${ref.wvmid}`;

// Kept once: a fixed state's plan is the same whenever it's read. A sketches-only group isn't a
// version of anything.
export async function saveSnapshot(robotId: string, kind: ModelKind, src: { did: string; eid?: string; wvm: string; wvmid: string; kind?: string }, plan: Plan, as?: FrozenRef) {
  const ref = as ?? (isFrozen(src) ? { wvm: src.wvm, wvmid: src.wvmid } : null);
  if (!ref || src.kind === "sketches" || !src.eid) return;
  // Without the build's own bookkeeping (its revision, which jobs were done).
  const kept: Record<string, unknown> = { ...plan };
  delete kept.rev;
  const jobs = plan.jobs.map((j) => {
    const copy: Record<string, unknown> = { ...j };
    delete copy.done;
    return copy;
  });
  await db
    .insert(schema.modelSnapshots)
    .values({ key: snapKey(kind, src, ref), robotId, plan: { ...kept, jobs } })
    .onConflictDoNothing();
}

export async function loadSnapshot(key: string) {
  const [row] = await db.select().from(schema.modelSnapshots).where(eq(schema.modelSnapshots.key, key));
  return row ?? null;
}

export async function markComplete(key: string) {
  await db.update(schema.modelSnapshots).set({ complete: true }).where(eq(schema.modelSnapshots.key, key));
}

export async function deleteSnapshot(key: string) {
  await db.delete(schema.modelSnapshots).where(eq(schema.modelSnapshots.key, key));
}
