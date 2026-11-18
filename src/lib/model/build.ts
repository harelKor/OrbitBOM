import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { GeometrySketch, ModelKind } from "@/db/schema";
import { logCalls, onshapeClient, OnshapeError, type OnshapeClient } from "@/lib/onshape/client";
import { partsList } from "@/lib/onshape/partsList";
import { fetchSketches } from "@/lib/onshape/sketches";
import { contextKey, studioRevisions, studioState, type StudioContext } from "@/lib/onshape/studioRevs";
import { apiPath, onshapeUrl, parseOnshapeUrl, type OnshapeRef } from "@/lib/onshape/url";
import { imageUrl, objectExists, putObject, StorageNotConfiguredError, storageConfigured } from "@/lib/storage/r2";
import { flattenAssembly, partKey, type AssemblyDefinition, type StudioRef } from "./assembly";
import { applyLimits, readMates, type GroupMates, type Joint, type LimitAsk, type ReadMates, type Relation } from "./mates";
import { saveSnapshot } from "./snapshotStore";
import { encodeMeshes, lookOf, meshesFromTessellation, type Appearance, type Mesh, type Tessellation } from "./mesh";

const { robots, systems, systemVersions, onshapeCache } = schema;

// The robot's 3D model, built from its systems' assemblies in Onshape. One build step runs
// per request until `deadline` and the browser calls again until it's done:
//   1. change check: each workspace assembly document's microversion (1 call each; stops if
//      unchanged). A system pinned by Update CAD (a version or microversion) needs none;
//   2. the assembly definitions of the groups that moved: every part and where it sits (1 call
//      per system), and each Part Studio's own revision (1 call per document context, kept for
//      versions and microversions); the other groups keep their plan;
//   3. one tessellation per Part Studio revision not already in R2 (1 call each). A Part
//      Studio's file is keyed by its own revision, so an edit or a new version re-exports only
//      what changed, and review rounds (src/lib/reviews/) share the same files.
//      When some bodies come without a colour, 1 more call reads the Part Studio's parts list
//      for their appearances.
// What's built is kept in onshape_cache under "robot-model:<robotId>"; nothing here runs
// while a page renders.

export const TESS_VERSION = "3"; // bump to re-export every mesh after changing the parameters below or the file format
export const TESS_QUERY = "angleTolerance=0.35&chordTolerance=0.0005&outputFacetNormals=false&outputVertexNormals=false&outputFaceAppearances=true";

export type ModelPlacement = { s: number; k: string; t: number[]; g?: number; b?: number }; // studio index, part key, transform, group, rigid body (mates.ts)
// A joint of the model (mates.ts) with its bodies numbered across the whole model and its group.
export type ModelJoint = Joint & { g: number };
// A group is one linked assembly: the systems that use it (usually one), for showing and
// hiding subsystems in the viewer. Models built before groups existed have none.
export type ModelGroup = { systemIds: string[]; name: string };
// `state`: the Part Studio's revision name (studioRevs.ts), so its parts list is shared with the BOM.
// `sketches`: a Geometry sketches job instead (sketch.ts): those sketches of the Part Studio at
// `path`, kept in R2 as JSON under `key`.
export type Job = { key: string; path: string; state?: string; configuration?: string; linkDid?: string; sketches?: GeometrySketch[]; done?: boolean };
// A Geometry sketches file placed in the model: its job / studio index, its transform, group, and
// the robot or system it belongs to (its sketches' keys, sketch.ts).
export type SketchPlacement = { s: number; t: number[]; g?: number; owner: string };
export type Built = { rev: string; builtAt: string; studios: string[]; placements: ModelPlacement[]; groups?: ModelGroup[]; sketches?: SketchPlacement[]; joints?: ModelJoint[]; relations?: Relation[] };
export type Draft = { rev: string; jobs: Job[]; placements: ModelPlacement[]; groups?: ModelGroup[]; names?: Record<string, string>; sketches?: SketchPlacement[]; joints?: ModelJoint[]; relations?: Relation[] };
const SKETCH_VERSION = "1"; // bump to fetch every sketch file again after changing its format
const PLAN_VERSION = "g3"; // g3: mates (2026-11-18) // bump when the plan's shape changes, so the next Update replans
// One group's plan (a linked assembly or Part Studio), kept so a rebuild reads only the groups
// that moved. `sketch`: its Geometry sketches' file (job j) and where they sit.
export type GroupPlan = { rev: string; jobs: Job[]; placements: { j: number; k: string; t: number[] }[]; names: Record<string, string>; sketch?: { j: number; t: number[]; owner: string }; mates?: GroupMates };
type State = { built?: Built; draft?: Draft; plans?: Record<string, GroupPlan> };

// The Final model keeps the key it always had; the Basepart model is new (Harel, 2026-11-12).
const cacheKey = (robotId: string, kind: ModelKind = "final") => (kind === "final" ? `robot-model:${robotId}` : `robot-model:${robotId}:${kind}`);

export async function loadState(robotId: string, kind: ModelKind = "final"): Promise<State> {
  const [row] = await db.select({ payload: onshapeCache.payload }).from(onshapeCache).where(eq(onshapeCache.key, cacheKey(robotId, kind)));
  return (row?.payload as State) ?? {};
}

// Only the built model, for the viewer and the part windows: the draft and the group plans can
// be far bigger and only the build steps need them (every 3D view sent the whole payload before,
// 2026-11-14).
async function loadBuilt(robotId: string, kind: ModelKind = "final"): Promise<Built | undefined> {
  const [row] = await db
    .select({ built: sql<Built | null>`${onshapeCache.payload} -> 'built'` })
    .from(onshapeCache)
    .where(eq(onshapeCache.key, cacheKey(robotId, kind)));
  return row?.built ?? undefined;
}

// The Final model's built state and, in the same read, the Basepart's sketches (its studios and
// sketch placements, not its parts), since the Final model shows them too.
async function loadFinalWithSketches(robotId: string): Promise<{ built?: Built; basepart?: Pick<Built, "studios" | "sketches"> }> {
  const finalKey = cacheKey(robotId, "final");
  const rows = await db
    .select({
      key: onshapeCache.key,
      built: sql<Built | null>`case when ${onshapeCache.key} = ${finalKey} then ${onshapeCache.payload} -> 'built' else jsonb_build_object('studios', ${onshapeCache.payload} -> 'built' -> 'studios', 'sketches', ${onshapeCache.payload} -> 'built' -> 'sketches') end`,
    })
    .from(onshapeCache)
    .where(inArray(onshapeCache.key, [finalKey, cacheKey(robotId, "basepart")]));
  const of = (key: string) => rows.find((r) => r.key === key)?.built ?? undefined;
  return { built: of(finalKey), basepart: of(cacheKey(robotId, "basepart")) };
}

async function saveState(robotId: string, state: State, kind: ModelKind = "final") {
  const values = { payload: state, microversion: state.built?.rev ?? null, fetchedAt: new Date() };
  await db
    .insert(onshapeCache)
    .values({ key: cacheKey(robotId, kind), ...values })
    .onConflictDoUpdate({ target: onshapeCache.key, set: values });
}

export async function deleteRobotModel(robotId: string) {
  await db.delete(onshapeCache).where(inArray(onshapeCache.key, [cacheKey(robotId, "final"), cacheKey(robotId, "basepart")]));
}

// When the robot's model was last built, for the dashboard. A database read only.
export async function robotModelBuiltAt(robotId: string, kind: ModelKind = "final"): Promise<string | null> {
  const [row] = await db
    .select({ builtAt: sql<string | null>`${onshapeCache.payload} -> 'built' ->> 'builtAt'` })
    .from(onshapeCache)
    .where(eq(onshapeCache.key, cacheKey(robotId, kind)));
  return row?.builtAt ?? null;
}

// Both models' build times, for pages with the Basepart | Final toggle (one read).
export async function robotModelsBuiltAt(robotId: string): Promise<Record<ModelKind, string | null>> {
  const rows = await db
    .select({ key: onshapeCache.key, builtAt: sql<string | null>`${onshapeCache.payload} -> 'built' ->> 'builtAt'` })
    .from(onshapeCache)
    .where(inArray(onshapeCache.key, [cacheKey(robotId, "final"), cacheKey(robotId, "basepart")]));
  const at = (kind: ModelKind) => rows.find((r) => r.key === cacheKey(robotId, kind))?.builtAt ?? null;
  return { final: at("final"), basepart: at("basepart") };
}

// The built model with short-lived links to its mesh files, for the viewer. With `systemId` (a
// system page, which only ever draws its own subsystem) just the placements of the groups that
// system is in, and only the Part Studio files they use: a phone downloads and decodes a few
// meshes instead of the whole robot. A model built before groups existed is sent whole.
// `keys` are the files' R2 keys, next to their links: a key names one Part Studio revision, so
// the browser keeps each file under it and downloads only the ones it hasn't seen
// (src/components/viewer/meshCache.ts).
// `sketches`: the Geometry sketch files (sketch.ts) and where they sit. The Final model shows the
// Basepart's sketches too, hidden until Shift+H (`sketchesHidden`; Harel, 2026-11-12).
export type ModelSketches = { url: string | null; key: string; t: number[]; g?: number; owner: string };
export type RobotModel = { builtAt: string; studios: (string | null)[]; keys: string[]; placements: ModelPlacement[]; groups: ModelGroup[]; sketches: ModelSketches[]; sketchesHidden?: boolean; joints?: ModelJoint[]; relations?: Relation[] };
export async function robotModel(robotId: string, systemId?: string, kind: ModelKind = "final"): Promise<RobotModel | null> {
  const { built, basepart } = kind === "final" ? await loadFinalWithSketches(robotId) : { built: await loadBuilt(robotId, kind), basepart: undefined };
  if (!built || !storageConfigured()) return null;
  const groups = built.groups ?? [];
  const own = (g: number | undefined) => !systemId || !groups.length || (g !== undefined && !!groups[g]?.systemIds.includes(systemId));
  const sketchKeys = new Set((built.sketches ?? []).map((s) => built.studios[s.s]));
  // Sketch files aren't meshes: the viewer gets them apart, and no studio link for them.
  let studios = built.studios.map((k) => (sketchKeys.has(k) ? null : k));
  let { placements } = built;
  if (systemId && groups.length) {
    const kept = placements.filter((p) => own(p.g));
    const used = [...new Set(kept.map((p) => p.s))];
    const index = new Map(used.map((s, i) => [s, i]));
    studios = used.map((s) => built.studios[s]);
    placements = kept.map((p) => ({ ...p, s: index.get(p.s)! }));
  }
  let sketches: Omit<ModelSketches, "url">[] = (built.sketches ?? []).filter((s) => own(s.g)).map((s) => ({ key: built.studios[s.s], t: s.t, g: s.g, owner: s.owner }));
  if (kind === "final") sketches = basepartSketchesFor(basepart, robotId, groups, systemId);
  // The joints of the groups sent, and the relations between them (renumbered).
  const jointIndex = new Map<number, number>();
  const joints = (built.joints ?? []).filter((j, i) => own(j.g) && jointIndex.set(i, jointIndex.size));
  const relations = (built.relations ?? []).flatMap((r) => (jointIndex.has(r.from) && jointIndex.has(r.to) ? [{ ...r, from: jointIndex.get(r.from)!, to: jointIndex.get(r.to)! }] : []));
  return {
    builtAt: built.builtAt,
    studios: await Promise.all(studios.map((key) => (key ? imageUrl(key) : null))),
    keys: studios.map((k) => k ?? ""),
    placements,
    groups,
    sketches: await Promise.all(sketches.map(async (s) => ({ ...s, url: await imageUrl(s.key) }))),
    ...(kind === "final" ? { sketchesHidden: true } : {}),
    ...(joints.length ? { joints } : {}),
    ...(relations.length ? { relations } : {}),
  };
}

// The Basepart model's sketches, moved onto the Final model's groups: a system's sketches go with
// the Final group that system is in (a system without a Final has nowhere to show them); the
// robot's own stay ungrouped.
function basepartSketchesFor(built: Pick<Built, "studios" | "sketches"> | undefined, robotId: string, groups: ModelGroup[], systemId?: string): Omit<ModelSketches, "url">[] {
  if (!built?.sketches?.length) return [];
  return built.sketches.flatMap((s) => {
    const key = built.studios[s.s];
    if (s.owner === robotId) return systemId ? [] : [{ key, t: s.t, owner: s.owner }];
    if (systemId && s.owner !== systemId) return [];
    const g = groups.findIndex((gr) => gr.systemIds.includes(s.owner));
    return g >= 0 ? [{ key, t: s.t, g, owner: s.owner }] : [];
  });
}

// Every part key in the built model with the R2 file of the Part Studio that holds it.
export async function builtStudios(robotId: string): Promise<Map<string, string>> {
  const built = await loadBuilt(robotId);
  return new Map(built?.placements.map((p) => [p.k, built.studios[p.s]]) ?? []);
}

// The R2 file of the robot model's Part Studio that holds this part, if the model has it.
export async function builtStudioFor(robotId: string, key: string): Promise<string | null> {
  const built = await loadBuilt(robotId);
  const placement = built?.placements.find((p) => p.k === key);
  return placement ? built!.studios[placement.s] : null;
}

// A Part Studio's meshes (1 call). Bodies the tessellation sent without a colour take the part's
// appearance from the Part Studio's parts list, which the BOM's part data reads too and keeps
// under the Part Studio's revision (partsList.ts): usually no call at all. That read is best
// effort: if it fails (Onshape's 402 included), those parts are drawn plain.
// `extra` is the query's tail: "&configuration=...", "&partId=...". `state`: the Part Studio's
// revision name (studioRevs.ts), when known.
export async function studioMeshes(client: OnshapeClient, path: string, extra = "", state: string | null = null): Promise<Mesh[]> {
  const tess = await client.json<Tessellation>(`partstudios/${path}/tessellatedfaces?${TESS_QUERY}${extra}`);
  let meshes = meshesFromTessellation(tess);
  if (meshes.some((m) => !m.appearance)) {
    const looks = await partAppearances(client, path, extra.replace(/&partId=[^&]*/g, ""), state);
    if (looks.size) meshes = meshesFromTessellation(tess, looks);
  }
  return meshes;
}

async function partAppearances(client: OnshapeClient, path: string, extra: string, state: string | null): Promise<Map<string, Appearance>> {
  try {
    const parts = await partsList(client, path, state, extra);
    return new Map(
      parts.flatMap((p) => {
        const look = p.partId ? lookOf(p.appearance) : undefined;
        return look ? [[p.partId, look] as const] : [];
      }),
    );
  } catch {
    return new Map();
  }
}

export type BuildStep =
  | { state: "done"; unchanged: boolean; parts: number; calls: number }
  | { state: "working"; done: number; total: number; calls: number };

// What a group is read from: an assembly (its definition), a Part Studio (its parts, where they
// were drawn: a Basepart before its assembly exists), or only Geometry sketches (the robot's own,
// when its Basepart isn't one of the model's sources). `sketch`: the Part Studio its chosen
// sketches come from, and whose they are (a system's id, or the robot's).
export type ModelSource = OnshapeRef & {
  group: ModelGroup;
  kind: "assembly" | "partstudio" | "sketches";
  sketch?: { studio: OnshapeRef; chosen: GeometrySketch[]; owner: string };
};

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// The sketches part of a source, when some were chosen.
function sketchOf(studioUrl: string | null, chosen: GeometrySketch[], owner: string): ModelSource["sketch"] {
  const studio = studioUrl ? parseOnshapeUrl(studioUrl) : null;
  return studio?.eid && chosen.length ? { studio, chosen, owner } : undefined;
}

// The model's sources. Final: every system's (Final) assembly, as FRCBOM's Onshape panel links
// them (subsystems are drawn where their own assembly puts them); a robot without linked systems
// falls back to its main (Final) assembly. Basepart (Harel, 2026-11-12): every system's Basepart,
// Part Studio or assembly, read on its workspace; the robot's own Basepart when no system has one,
// else just its Geometry sketches.
export async function modelSources(robotId: string, kind: ModelKind = "final"): Promise<ModelSource[]> {
  if (kind === "basepart") return basepartSources(robotId);
  const rows = await db
    .select({ id: systems.id, name: systems.name, url: systems.assemblyUrl, follow: systems.followVersions, seen: systems.followedVersionId, pinned: systems.modelRef, ref: systemVersions.onshapeRef })
    .from(systems)
    .leftJoin(systemVersions, eq(systemVersions.id, systems.currentVersionId))
    .where(eq(systems.robotId, robotId))
    .orderBy(asc(systems.createdAt));
  const sources: ModelSource[] = [];
  for (const r of rows) {
    const linked = r.url ? parseOnshapeUrl(r.url) : null;
    if (!linked?.eid) continue;
    // Read where the last Update CAD (or Update BOM with its 3D views) left it: a version or a
    // microversion. Before any, a system that follows Onshape versions is drawn at the version
    // it's on, not the students' workspace; before its first commit, at the newest version seen.
    const vid = r.follow ? (r.ref?.vid ?? r.seen) : null;
    const ref = r.pinned ? { ...linked, wvm: r.pinned.wvm, wvmid: r.pinned.wvmid } : vid ? { ...linked, wvm: "v" as const, wvmid: vid } : linked;
    const same = sources.find((o) => onshapeUrl(o) === onshapeUrl(ref));
    if (same) {
      same.group.systemIds.push(r.id);
      same.group.name += `, ${r.name}`;
    } else sources.push({ ...ref, kind: "assembly", group: { systemIds: [r.id], name: r.name } });
  }
  if (sources.length) return sources;
  const [robot] = await db.select({ name: robots.name, url: robots.mainAssemblyUrl }).from(robots).where(eq(robots.id, robotId));
  const main = robot?.url ? parseOnshapeUrl(robot.url) : null;
  return main?.eid ? [{ ...main, kind: "assembly", group: { systemIds: [], name: robot.name } }] : [];
}

async function basepartSources(robotId: string): Promise<ModelSource[]> {
  const [rows, [robot]] = await Promise.all([
    db
      .select({ id: systems.id, name: systems.name, url: systems.basepartUrl, kind: systems.basepartKind, studio: systems.basepartStudioUrl, sketches: systems.basepartSketches, pinned: systems.basepartModelRef })
      .from(systems)
      .where(eq(systems.robotId, robotId))
      .orderBy(asc(systems.createdAt)),
    db.select({ name: robots.name, url: robots.basepartUrl, kind: robots.basepartKind, studio: robots.basepartStudioUrl, sketches: robots.basepartSketches, pinned: robots.basepartModelRef }).from(robots).where(eq(robots.id, robotId)),
  ]);
  const sources: ModelSource[] = [];
  for (const r of rows) {
    const linked = r.url ? parseOnshapeUrl(r.url) : null;
    if (!linked?.eid) continue;
    // Where the last Basepart update was committed (Harel, 2026-11-13), else its workspace.
    const ref = r.pinned ? { ...linked, wvm: r.pinned.wvm, wvmid: r.pinned.wvmid } : linked;
    const same = sources.find((o) => onshapeUrl(o) === onshapeUrl(ref));
    if (same) {
      same.group.systemIds.push(r.id);
      same.group.name += `, ${r.name}`;
    } else sources.push({ ...ref, kind: r.kind === "partstudio" ? "partstudio" : "assembly", group: { systemIds: [r.id], name: r.name }, sketch: sketchOf(r.studio, r.sketches, r.id) });
  }
  if (!robot) return sources;
  const ownLink = robot.url ? parseOnshapeUrl(robot.url) : null;
  const own = ownLink && robot.pinned ? { ...ownLink, wvm: robot.pinned.wvm, wvmid: robot.pinned.wvmid } : ownLink;
  const sketch = sketchOf(robot.studio, robot.sketches, robotId);
  if (!sources.length && own?.eid) return [{ ...own, kind: robot.kind === "partstudio" ? "partstudio" : "assembly", group: { systemIds: [], name: robot.name }, sketch }];
  if (sketch) sources.push({ ...sketch.studio, kind: "sketches", group: { systemIds: [], name: `${robot.name} geometry` }, sketch });
  return sources;
}

// One group's revision: where its assembly is read, and the workspace's microversion. A version
// or microversion never changes, so a pinned group's plan is read from Onshape once. The chosen
// sketches are part of it, so choosing others plans again.
export const groupRev = (ref: ModelSource, mv: string | undefined) =>
  `${PLAN_VERSION}|${TESS_VERSION}|${ref.kind}|${ref.wvm}:${ref.wvmid}:${ref.eid}:${mv ?? ""}${ref.sketch ? `|${SKETCH_VERSION}:${ref.sketch.studio.eid}:${ref.sketch.chosen.map((s) => s.id).join(",")}` : ""}`;
export const groupKey = (ref: { did: string; eid?: string; kind?: ModelSource["kind"] }) => `${ref.kind === "sketches" ? "sketches:" : ""}${ref.did}:${ref.eid}`;

export async function buildRobotModel(robotId: string, memberId: string, deadline: number, kind: ModelKind = "final"): Promise<BuildStep> {
  if (!storageConfigured()) throw new StorageNotConfiguredError();
  const sources = await modelSources(robotId, kind);
  if (!sources.length) throw new OnshapeError(kind === "basepart" ? "Sync a Basepart Part Studio or assembly from the Onshape panel first." : "Link this robot's systems to their Onshape assemblies first.");
  const client = onshapeClient(memberId, sources[0].baseUrl);
  try {
    return await buildStep(robotId, client, sources, deadline, kind);
  } finally {
    logCalls(kind === "basepart" ? "3d-model-basepart" : "3d-model", client);
  }
}

async function buildStep(robotId: string, client: OnshapeClient, sources: ModelSource[], deadline: number, kind: ModelKind): Promise<BuildStep> {
  const state = await loadState(robotId, kind);
  const save = (s: State) => saveState(robotId, s, kind);

  // 1. Change check: one microversion call per workspace document, all at once. Versions and
  // microversions never change.
  const workspaces = new Map(sources.filter((ref) => ref.wvm === "w").map((ref) => [ref.wvmid, ref.did]));
  const mvs = new Map(
    await Promise.all(
      [...workspaces].map(async ([wvmid, did]) => {
        const mv = await client.json<{ microversion: string }>(`documents/d/${did}/w/${wvmid}/currentmicroversion`);
        return [wvmid, mv.microversion] as const;
      }),
    ),
  );
  const revs = sources.map((ref) => groupRev(ref, mvs.get(ref.wvmid)));
  const rev = sources.map((ref, g) => `${revs[g]}:${ref.group.systemIds.join(",")}`).join("|");
  if (state.built?.rev === rev) {
    return { state: "done", unchanged: true, parts: state.built.placements.length, calls: client.calls };
  }

  // 2. Where every part sits, and which Part Studio files that needs: only the groups whose
  // assembly moved are read again (1 definition each); the others keep their plan.
  let draft = state.draft?.rev === rev ? state.draft : undefined;
  const kept = state.plans ?? {};
  const plans: Record<string, GroupPlan> = {};
  for (const [g, ref] of sources.entries()) if (kept[groupKey(ref)]?.rev === revs[g]) plans[groupKey(ref)] = kept[groupKey(ref)];
  if (!draft) {
    const stale = sources.flatMap((ref, g) => (plans[groupKey(ref)] ? [] : [g]));
    const fresh = await Promise.all(stale.map((g) => planGroup(client, sources[g], revs[g])));
    stale.forEach((g, i) => (plans[groupKey(sources[g])] = fresh[i]));
    // A group read at a fixed version or microversion is that version's model: kept for the
    // version tree (snapshotStore.ts).
    for (const [i, g] of stale.entries()) await saveSnapshot(robotId, kind, sources[g], fresh[i]);
    draft = mergePlans(sources, plans, rev);
    await save({ ...state, draft, plans });
  }

  // 3. Part Studio meshes and sketch files, eight at a time.
  try {
    await runJobs(client, draft, deadline);
  } finally {
    await save({ ...state, draft, plans });
  }

  const done = draft.jobs.filter((j) => j.done).length;
  if (done < draft.jobs.length) return { state: "working", done, total: draft.jobs.length, calls: client.calls };

  const built: Built = {
    rev,
    builtAt: new Date().toISOString(),
    studios: draft.jobs.map((j) => j.key),
    placements: draft.placements,
    groups: draft.groups,
    ...(draft.sketches?.length ? { sketches: draft.sketches } : {}),
    ...(draft.joints?.length ? { joints: draft.joints } : {}),
    ...(draft.relations?.length ? { relations: draft.relations } : {}),
  };
  await save({ built, plans });
  return { state: "done", unchanged: false, parts: built.placements.length, calls: client.calls };
}

// The whole model, step after step, on the server (no time limit there since the move off
// Vercel): for work nobody watches in a browser, like a system linked from the Onshape panel.
export async function buildRobotModelFully(robotId: string, memberId: string, ms = 10 * 60_000, kind: ModelKind = "final"): Promise<BuildStep> {
  const until = Date.now() + ms;
  for (;;) {
    const step = await buildRobotModel(robotId, memberId, Math.min(until, Date.now() + 150_000), kind);
    if (step.state === "done" || Date.now() > until) return step;
  }
}

// Exports the Part Studio files a plan still needs, eight at a time. A job only starts while
// there is time left to finish it inside the request; the rest waits for the browser's next call.
// A file already in R2 (the same Part Studio revision, shown by another model) costs nothing.
export async function runJobs(client: OnshapeClient, draft: { jobs: Job[] }, deadline: number) {
  const queue = draft.jobs.filter((j) => !j.done);
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (Date.now() > deadline) return;
      if (!(await objectExists(job.key))) {
        if (job.sketches) {
          const file = await fetchSketches(client, job.path, job.sketches);
          await putObject(job.key, gzipSync(Buffer.from(JSON.stringify(file))), "application/gzip");
        } else {
          const config = job.configuration ? `&configuration=${encodeURIComponent(job.configuration)}` : "";
          const link = job.linkDid ? `&linkDocumentId=${job.linkDid}` : "";
          const meshes = await studioMeshes(client, job.path, `${config}${link}`, job.state ?? null);
          await putObject(job.key, gzipSync(encodeMeshes(meshes)), "application/gzip");
        }
      }
      job.done = true;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
}

// The context a placed Part Studio is read in: a linked document's version or microversion, or
// the assembly's own document as the assembly is read (its workspace, version or microversion).
export function studioContext(s: StudioRef, ref: OnshapeRef): StudioContext | null {
  if (s.did === ref.did && !s.version) return { did: ref.did, wvm: ref.wvm, wvmid: ref.wvmid };
  if (s.version) return { did: s.did, wvm: "v", wvmid: s.version };
  if (s.microversion) return { did: s.did, wvm: "m", wvmid: s.microversion };
  return null;
}

// One group's plan: its assembly's definition (1 call), each Part Studio's revision
// (studioRevisions: 1 call per workspace context, kept for versions and microversions) and one
// export job per Part Studio revision. A file is keyed by the Part Studio's own revision, so a
// Part Studio that didn't change is exported once and shared by every model and Onshape version.
// A Part Studio source is its own parts where they were drawn (its parts list: 1 call, shared
// with the BOM's part data); a sketches-only source has no parts. Chosen Geometry sketches add one
// sketch file job, placed where the assembly puts that Part Studio (where it was drawn, when the
// assembly doesn't place any of its parts).
export async function planGroup(client: OnshapeClient, ref: ModelSource, rev: string): Promise<GroupPlan> {
  const jobs: Job[] = [];
  const jobIndex = new Map<string, number>();
  const placements: GroupPlan["placements"] = [];
  const names: Record<string, string> = {}; // part key → its instance name in Onshape
  const own: StudioRef = { did: ref.did, eid: ref.eid! };
  const sketchStudio: StudioRef | null = ref.sketch ? { did: ref.sketch.studio.did, eid: ref.sketch.studio.eid! } : null;
  const raw =
    ref.kind === "assembly"
      ? await client.json<AssemblyDefinition>(`assemblies/${apiPath(ref)}?includeMateFeatures=true&includeNonSolids=false&includeMateConnectors=false`)
      : null;
  const def = raw ? flattenAssembly(raw) : [];
  // The mates (mates.ts) come in the same answer; only their limits cost calls.
  const mates = raw ? await matesOf(client, ref, raw, def.map((p) => p.path)) : undefined;
  const contexts = [...def.map((p) => p.studio), ...(ref.kind === "partstudio" ? [own] : []), ...(sketchStudio ? [sketchStudio] : [])];
  const revisions = await studioRevisions(client, contexts.flatMap((s) => studioContext(s, ref) ?? []));

  const pathOf = (s: StudioRef) => {
    const same = s.did === ref.did && !s.version;
    return same
      ? `d/${s.did}/${ref.wvm}/${ref.wvmid}/e/${s.eid}`
      : s.version
        ? `d/${s.did}/v/${s.version}/e/${s.eid}`
        : s.microversion
          ? `d/${s.did}/m/${s.microversion}/e/${s.eid}`
          : apiPath({ ...ref, did: s.did, eid: s.eid });
  };
  const elementOf = (s: StudioRef) => {
    const context = studioContext(s, ref);
    return context ? revisions.get(contextKey(context))?.get(s.eid) : undefined;
  };
  // The Part Studio's own state: its element revision, else what the read context names.
  const studioRevOf = (s: StudioRef) => {
    const element = elementOf(s);
    const same = s.did === ref.did && !s.version;
    // Without its element revision, a frozen context still names one state; in a workspace the
    // group's revision does (re-exported whenever the assembly's document changes).
    return element
      ? `e${element}`
      : s.version
        ? `v${s.version}`
        : s.microversion
          ? `m${s.microversion}`
          : same && ref.wvm !== "w"
            ? `${ref.wvm}${ref.wvmid}`
            : rev;
  };
  const add = (job: Job) => {
    let index = jobIndex.get(job.key);
    if (index === undefined) {
      index = jobs.push(job) - 1;
      jobIndex.set(job.key, index);
    }
    return index;
  };

  const jobFor = (s: StudioRef): number => {
    const element = elementOf(s);
    const hash = createHash("sha1")
      .update(`${TESS_VERSION}|${studioRevOf(s)}|${s.configuration ?? ""}`)
      .digest("hex")
      .slice(0, 20);
    return add({
      key: `models/studios/${s.did}/${s.eid}/${hash}.bin.gz`,
      path: pathOf(s),
      ...(element ? { state: studioState(s.did, s.eid, element) } : {}),
      ...(s.configuration ? { configuration: s.configuration } : {}),
      ...(s.did !== ref.did ? { linkDid: ref.did } : {}),
    });
  };

  for (const p of def) {
    const k = partKey(p.studio.did, p.studio.eid, p.partId);
    placements.push({ j: jobFor(p.studio), k, t: p.transform });
    if (p.name) names[k] = p.name;
  }
  if (ref.kind === "partstudio") {
    // Every solid part where the Part Studio drew it (flat patterns are drawn by the sheet metal
    // part they come from).
    const j = jobFor(own);
    const element = elementOf(own);
    const parts = await partsList(client, pathOf(own), element ? studioState(own.did, own.eid, element) : null);
    for (const p of parts) {
      if (!p.partId || p.isFlattenedBody || (p.bodyType && p.bodyType !== "solid")) continue;
      const k = partKey(own.did, own.eid, p.partId);
      placements.push({ j, k, t: IDENTITY });
      if (p.name) names[k] = p.name;
    }
  }
  let sketch: GroupPlan["sketch"];
  if (ref.sketch && sketchStudio) {
    const hash = createHash("sha1")
      .update(`${SKETCH_VERSION}|${studioRevOf(sketchStudio)}|${ref.sketch.chosen.map((s) => s.id).join(",")}`)
      .digest("hex")
      .slice(0, 20);
    const j = add({ key: `models/sketches/${sketchStudio.did}/${sketchStudio.eid}/${hash}.json.gz`, path: pathOf(sketchStudio), sketches: ref.sketch.chosen });
    const placed = def.find((p) => p.studio.did === sketchStudio.did && p.studio.eid === sketchStudio.eid);
    sketch = { j, t: placed?.transform ?? IDENTITY, owner: ref.sketch.owner };
  }
  return { rev, jobs, placements, names, ...(sketch ? { sketch } : {}), ...(mates ? { mates } : {}) };
}

const LIMIT_CALLS = 6; // at most this many assembly elements' limits per group (1 call each)

// The group's mates and, for assembly elements with moving mates, their limits from the features
// list (best effort). One log line says what was found, to check a real assembly's answer.
async function matesOf(client: OnshapeClient, ref: ModelSource, raw: AssemblyDefinition, paths: string[][]): Promise<GroupMates | undefined> {
  let read: ReadMates;
  try {
    read = readMates(raw, paths);
  } catch (err) {
    console.error(`model mates ${ref.eid}: couldn't read them`, err);
    return undefined;
  }
  const kinds = new Map<string, number>();
  for (const f of [...(raw.rootAssembly?.features ?? []), ...(raw.subAssemblies ?? []).flatMap((x) => x.features ?? [])]) {
    const d = f.featureData ?? {};
    const kind = `${f.featureType}${d.mateType ? `:${d.mateType}` : d.relationType ? `:${d.relationType}` : ""}`;
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  let calls = 0;
  for (const ask of read.asks.slice(0, LIMIT_CALLS)) {
    const path = limitPath(ref, ask);
    if (!path) continue;
    try {
      calls++;
      applyLimits(read.joints, ask, await client.json(`assemblies/${path}`));
    } catch (err) {
      console.error(`model mates ${ref.eid}: no limits from ${path}`, err instanceof Error ? err.message : err);
    }
  }
  const { joints, relations, bodies } = read;
  console.log(`model mates ${ref.eid}: ${[...kinds].map(([k, n]) => `${k}=${n}`).join(" ") || "no features"}; bodies=${new Set(bodies.filter((b) => b >= 0)).size} joints=${joints.length} limited=${joints.filter((j) => j.lim).length} relations=${relations?.length ?? 0} limitCalls=${calls}`);
  return { bodies, joints, ...(relations?.length ? { relations } : {}) };
}

// Where an assembly element's features list is read: the root as the assembly is read, a
// sub-assembly in the same document the same way, one in another document at its microversion.
function limitPath(ref: ModelSource, ask: LimitAsk): string | null {
  if (ask.root) return `${apiPath(ref)}/features`;
  if (!ask.did || !ask.eid) return null;
  const config = ask.configuration && ask.configuration !== "default" ? `configuration=${encodeURIComponent(ask.configuration)}` : "";
  if (ask.did === ref.did) return `d/${ref.did}/${ref.wvm}/${ref.wvmid}/e/${ask.eid}/features${config ? `?${config}` : ""}`;
  if (!ask.microversion) return null;
  return `d/${ask.did}/m/${ask.microversion}/e/${ask.eid}/features?linkDocumentId=${ref.did}${config ? `&${config}` : ""}`;
}

// The robot's plan from its groups' plans: each Part Studio file once, placements by group.
export function mergePlans(sources: { did: string; eid?: string; kind?: ModelSource["kind"]; group: ModelGroup }[], plans: Record<string, GroupPlan>, rev: string): Draft {
  const jobs: Job[] = [];
  const jobIndex = new Map<string, number>();
  const placements: ModelPlacement[] = [];
  const sketches: SketchPlacement[] = [];
  const names: Record<string, string> = {};
  const joints: ModelJoint[] = [];
  const relations: Relation[] = [];
  let bodyBase = 0; // each group's bodies numbered after the ones before
  sources.forEach((ref, g) => {
    const plan = plans[groupKey(ref)];
    const global = plan.jobs.map((job) => {
      let index = jobIndex.get(job.key);
      if (index === undefined) {
        index = jobs.push({ ...job, done: false }) - 1;
        jobIndex.set(job.key, index);
      }
      return index;
    });
    const m = plan.mates;
    const jointBase = joints.length;
    plan.placements.forEach((p, i) => {
      const b = m?.bodies[i] ?? -1;
      placements.push({ s: global[p.j], k: p.k, t: p.t, g, ...(b >= 0 ? { b: bodyBase + b } : {}) });
    });
    if (m) {
      for (const j of m.joints) joints.push({ ...j, a: bodyBase + j.a, b: bodyBase + j.b, g });
      for (const r of m.relations ?? []) relations.push({ ...r, from: jointBase + r.from, to: jointBase + r.to });
      bodyBase += Math.max(-1, ...m.bodies, ...m.joints.flatMap((j) => [j.a, j.b])) + 1;
    }
    if (plan.sketch) sketches.push({ s: global[plan.sketch.j], t: plan.sketch.t, g, owner: plan.sketch.owner });
    Object.assign(names, plan.names);
  });
  return { rev, jobs, placements, groups: sources.map((s) => s.group), names, ...(sketches.length ? { sketches } : {}), ...(joints.length ? { joints } : {}), ...(relations.length ? { relations } : {}) };
}

// ---------- Update CAD / Update Basepart (Harel, 2026-11-13) ----------
// The Commit window compares one system's (or the robot's own Basepart's) model as it is now in
// Onshape with what the 3D model has. "Now" is the workspace pinned to its current microversion,
// so what the member reviews is exactly what gets committed.

export type ModelOwner = { systemId: string } | { robotId: string };
export const ownsSource = (owner: ModelOwner) => (s: ModelSource) =>
  s.kind !== "sketches" && ("systemId" in owner ? s.group.systemIds.includes(owner.systemId) : s.group.systemIds.length === 0);

export type GroupNow = { now: ModelSource; plan: GroupPlan; old: GroupPlan | null; microversion: string; workspace: OnshapeRef };

// The owner's group read now (its definition or parts list, and its Part Studio revisions: 2–3
// calls, plus 1 for the microversion) and the plan the built model has for it.
export async function planGroupNow(client: OnshapeClient, robotId: string, kind: ModelKind, owner: ModelOwner, workspace: OnshapeRef): Promise<GroupNow> {
  const sources = await modelSources(robotId, kind);
  const source = sources.find(ownsSource(owner));
  // 409: not one of the model's sources (the robot's own Basepart once systems have theirs: only
  // its Geometry sketches are drawn then).
  if (!source || source.did !== workspace.did || source.eid !== workspace.eid) throw new OnshapeError("This isn't drawn in the model on its own.", 409);
  if (workspace.wvm !== "w") throw new OnshapeError("This is linked to a fixed Onshape version, so it can't move. Link its workspace to update it.");
  const { microversion } = await client.json<{ microversion: string }>(`documents/d/${workspace.did}/w/${workspace.wvmid}/currentmicroversion`);
  const now: ModelSource = { ...source, wvm: "m", wvmid: microversion };
  const plan = await planGroup(client, now, groupRev(now, undefined));
  const state = await loadState(robotId, kind);
  return { now, plan, old: state.plans?.[groupKey(source)] ?? null, microversion, workspace };
}

// After the commit: the group's plan read for the Commit window becomes the model's plan at the
// state it was pinned to (the same parts and files), so the rebuild reads nothing again for it.
export async function adoptGroupPlan(robotId: string, kind: ModelKind, owner: ModelOwner, plan: GroupPlan) {
  const sources = await modelSources(robotId, kind);
  const source = sources.find(ownsSource(owner));
  if (!source) return;
  const state = await loadState(robotId, kind);
  await saveState(robotId, { ...state, plans: { ...state.plans, [groupKey(source)]: { ...plan, rev: groupRev(source, undefined) } } }, kind);
}

