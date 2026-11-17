import "server-only";
import type { ModelKind } from "@/db/schema";
import { logCalls, onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { imageUrl, objectExists, storageConfigured, StorageNotConfiguredError } from "@/lib/storage/r2";
import { groupKey, groupRev, loadState, modelSources, ownsSource, planGroup, runJobs, type GroupPlan, type Job, type ModelOwner, type ModelSource } from "./build";
import { loadSnapshot, markComplete, saveSnapshot, snapKey, type FrozenRef } from "./snapshotStore";

// A version's 3D model for the CAD page (plan/cad-versions.md, Harel 2026-11-17): one or more
// owners (a system, or the robot's own Basepart) each at a fixed Onshape state, drawn from the kept
// snapshots (snapshotStore.ts) with no Onshape calls. A state nobody kept yet (made before
// 2026-11-17) is built once on request (`buildSnapshot`), on the member's Onshape account.

export type VersionEntry = { owner: ModelOwner; ref: FrozenRef; name: string };

// The owner's source in the model, read at `ref` (its link stays; only the state moves).
async function sourceAt(robotId: string, kind: ModelKind, owner: ModelOwner, ref: FrozenRef): Promise<ModelSource | null> {
  const sources = await modelSources(robotId, kind);
  const src = sources.find(ownsSource(owner));
  return src ? { ...src, wvm: ref.wvm, wvmid: ref.wvmid } : null;
}

// Before any snapshot was kept: the state the built model is pinned to is the one its group plan
// was read at, so that plan is this version's.
async function backfill(robotId: string, kind: ModelKind, owner: ModelOwner, ref: FrozenRef) {
  const current = (await modelSources(robotId, kind)).find(ownsSource(owner));
  if (!current || current.wvm !== ref.wvm || current.wvmid !== ref.wvmid) return null;
  const plan = (await loadState(robotId, kind)).plans?.[groupKey(current)];
  if (!plan || plan.rev !== groupRev(current, undefined)) return null;
  await saveSnapshot(robotId, kind, current, plan);
  return loadSnapshot(snapKey(kind, current, ref));
}

export type VersionModel = {
  studios: (string | null)[];
  keys: string[];
  placements: { s: number; k: string; t: number[]; g: number }[];
  groups: { systemIds: string[]; name: string }[];
  names: Record<string, string>;
  sketches: { url: string | null; key: string; t: number[]; g: number; owner: string }[];
};
export type VersionAnswer = { state: "ready"; model: VersionModel } | { state: "missing"; why: "plan" | "files"; entry: number } | { state: "error"; error: string };

// Every entry's snapshot merged into one model, entry i as group i.
export async function versionModel(robotId: string, kind: ModelKind, entries: VersionEntry[]): Promise<VersionAnswer> {
  if (!storageConfigured()) return { state: "error", error: "File storage isn't set up." };
  const studios: string[] = [];
  const index = new Map<string, number>();
  const at = (key: string) => {
    let i = index.get(key);
    if (i === undefined) {
      i = studios.push(key) - 1;
      index.set(key, i);
    }
    return i;
  };
  const placements: VersionModel["placements"] = [];
  const sketches: Omit<VersionModel["sketches"][number], "url">[] = [];
  const names: Record<string, string> = {};
  const groups: VersionModel["groups"] = [];
  const sketchFiles = new Set<string>();
  for (const [g, e] of entries.entries()) {
    const src = await sourceAt(robotId, kind, e.owner, e.ref);
    if (!src?.eid) return { state: "error", error: "This version's model isn't linked any more." };
    const key = snapKey(kind, src, e.ref);
    const row = (await loadSnapshot(key)) ?? (await backfill(robotId, kind, e.owner, e.ref));
    if (!row) return { state: "missing", why: "plan", entry: g };
    const plan = row.plan as GroupPlan;
    if (!row.complete) {
      const there = await Promise.all(plan.jobs.map((j) => objectExists(j.key)));
      if (there.some((x) => !x)) return { state: "missing", why: "files", entry: g };
      await markComplete(key);
    }
    const global = plan.jobs.map((j) => at(j.key));
    for (const p of plan.placements) placements.push({ s: global[p.j], k: p.k, t: p.t, g });
    if (plan.sketch) {
      sketchFiles.add(plan.jobs[plan.sketch.j].key);
      sketches.push({ key: plan.jobs[plan.sketch.j].key, t: plan.sketch.t, g, owner: plan.sketch.owner });
    }
    Object.assign(names, plan.names);
    groups.push({ systemIds: "systemId" in e.owner ? [e.owner.systemId] : [], name: e.name });
  }
  const meshes = studios.map((k) => (sketchFiles.has(k) ? null : k));
  return {
    state: "ready",
    model: {
      studios: await Promise.all(meshes.map((k) => (k ? imageUrl(k) : null))),
      keys: meshes.map((k) => k ?? ""),
      placements,
      groups,
      names,
      sketches: await Promise.all(sketches.map(async (s) => ({ ...s, url: await imageUrl(s.key) }))),
    },
  };
}

export type SnapshotStep = { state: "done"; calls: number } | { state: "working"; done: number; total: number; calls: number };

// One build step of an old version's model: its plan (the assembly's definition and Part Studio
// revisions at that version: 2–3 calls) the first time, then the Part Studio files R2 doesn't
// have yet (1 call each; files are shared by every version, so usually few).
export async function buildSnapshot(robotId: string, kind: ModelKind, owner: ModelOwner, ref: FrozenRef, memberId: string, deadline: number): Promise<SnapshotStep> {
  if (!storageConfigured()) throw new StorageNotConfiguredError();
  const src = await sourceAt(robotId, kind, owner, ref);
  if (!src?.eid) throw new OnshapeError("This version's model isn't linked any more.");
  const key = snapKey(kind, src, ref);
  const client = onshapeClient(memberId, src.baseUrl);
  try {
    let row = await loadSnapshot(key);
    if (!row) {
      const plan = await planGroup(client, src, groupRev(src, undefined));
      await saveSnapshot(robotId, kind, src, plan);
      row = await loadSnapshot(key);
      if (!row) throw new OnshapeError("This version couldn't be kept. Try again.");
    }
    if (row.complete) return { state: "done", calls: client.calls };
    const jobs = (row.plan as GroupPlan).jobs.map((j: Job) => ({ ...j, done: false }));
    await runJobs(client, { jobs }, deadline);
    const done = jobs.filter((j) => j.done).length;
    if (done < jobs.length) return { state: "working", done, total: jobs.length, calls: client.calls };
    await markComplete(key);
    return { state: "done", calls: client.calls };
  } finally {
    logCalls("version-model", client);
  }
}

// Keeps the state the built model is on now as a snapshot (Create version on the whole robot), so
// that version can be drawn later without Onshape. Its state, or null when it's on a workspace.
export async function keepCurrentSnapshot(robotId: string, kind: ModelKind, owner: ModelOwner): Promise<FrozenRef | null> {
  const current = (await modelSources(robotId, kind)).find(ownsSource(owner));
  if (!current?.eid || (current.wvm !== "v" && current.wvm !== "m")) return null;
  const ref: FrozenRef = { wvm: current.wvm, wvmid: current.wvmid };
  if (!(await loadSnapshot(snapKey(kind, current, ref)))) await backfill(robotId, kind, owner, ref);
  return ref;
}
