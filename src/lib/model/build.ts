import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { logCalls, onshapeClient, OnshapeError, type OnshapeClient } from "@/lib/onshape/client";
import { partsList } from "@/lib/onshape/partsList";
import { contextKey, studioRevisions, studioState, type StudioContext } from "@/lib/onshape/studioRevs";
import { apiPath, onshapeUrl, parseOnshapeUrl, type OnshapeRef } from "@/lib/onshape/url";
import { imageUrl, objectExists, putObject, StorageNotConfiguredError, storageConfigured } from "@/lib/storage/r2";
import { flattenAssembly, partKey, type AssemblyDefinition, type StudioRef } from "./assembly";
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

export type ModelPlacement = { s: number; k: string; t: number[]; g?: number }; // studio index, part key, transform, group
// A group is one linked assembly: the systems that use it (usually one), for showing and
// hiding subsystems in the viewer. Models built before groups existed have none.
export type ModelGroup = { systemIds: string[]; name: string };
// `state`: the Part Studio's revision name (studioRevs.ts), so its parts list is shared with the BOM.
export type Job = { key: string; path: string; state?: string; configuration?: string; linkDid?: string; done?: boolean };
export type Built = { rev: string; builtAt: string; studios: string[]; placements: ModelPlacement[]; groups?: ModelGroup[] };
export type Draft = { rev: string; jobs: Job[]; placements: ModelPlacement[]; groups?: ModelGroup[]; names?: Record<string, string> };
const PLAN_VERSION = "g2"; // bump when the plan's shape changes, so the next Update replans
// One group's plan (a linked assembly), kept so a rebuild reads only the groups that moved.
type GroupPlan = { rev: string; jobs: Job[]; placements: { j: number; k: string; t: number[] }[]; names: Record<string, string> };
type State = { built?: Built; draft?: Draft; plans?: Record<string, GroupPlan> };

const cacheKey = (robotId: string) => `robot-model:${robotId}`;

async function loadState(robotId: string): Promise<State> {
  const [row] = await db.select({ payload: onshapeCache.payload }).from(onshapeCache).where(eq(onshapeCache.key, cacheKey(robotId)));
  return (row?.payload as State) ?? {};
}

async function saveState(robotId: string, state: State) {
  const values = { payload: state, microversion: state.built?.rev ?? null, fetchedAt: new Date() };
  await db
    .insert(onshapeCache)
    .values({ key: cacheKey(robotId), ...values })
    .onConflictDoUpdate({ target: onshapeCache.key, set: values });
}

export async function deleteRobotModel(robotId: string) {
  await db.delete(onshapeCache).where(eq(onshapeCache.key, cacheKey(robotId)));
}

// When the robot's model was last built, for the dashboard. A database read only.
export async function robotModelBuiltAt(robotId: string): Promise<string | null> {
  const [row] = await db
    .select({ builtAt: sql<string | null>`${onshapeCache.payload} -> 'built' ->> 'builtAt'` })
    .from(onshapeCache)
    .where(eq(onshapeCache.key, cacheKey(robotId)));
  return row?.builtAt ?? null;
}

// The built model with short-lived links to its mesh files, for the viewer. With `systemId` (a
// system page, which only ever draws its own subsystem) just the placements of the groups that
// system is in, and only the Part Studio files they use: a phone downloads and decodes a few
// meshes instead of the whole robot. A model built before groups existed is sent whole.
// `keys` are the files' R2 keys, next to their links: a key names one Part Studio revision, so
// the browser keeps each file under it and downloads only the ones it hasn't seen
// (src/components/viewer/meshCache.ts).
export type RobotModel = { builtAt: string; studios: (string | null)[]; keys: string[]; placements: ModelPlacement[]; groups: ModelGroup[] };
export async function robotModel(robotId: string, systemId?: string): Promise<RobotModel | null> {
  const { built } = await loadState(robotId);
  if (!built || !storageConfigured()) return null;
  const groups = built.groups ?? [];
  let { studios, placements } = built;
  if (systemId && groups.length) {
    const own = new Set(groups.flatMap((g, i) => (g.systemIds.includes(systemId) ? [i] : [])));
    const kept = placements.filter((p) => p.g !== undefined && own.has(p.g));
    const used = [...new Set(kept.map((p) => p.s))];
    const index = new Map(used.map((s, i) => [s, i]));
    studios = used.map((s) => built.studios[s]);
    placements = kept.map((p) => ({ ...p, s: index.get(p.s)! }));
  }
  return {
    builtAt: built.builtAt,
    studios: await Promise.all(studios.map((key) => imageUrl(key))),
    keys: studios,
    placements,
    groups,
  };
}

// Every part key in the built model with the R2 file of the Part Studio that holds it.
export async function builtStudios(robotId: string): Promise<Map<string, string>> {
  const { built } = await loadState(robotId);
  return new Map(built?.placements.map((p) => [p.k, built.studios[p.s]]) ?? []);
}

// The R2 file of the robot model's Part Studio that holds this part, if the model has it.
export async function builtStudioFor(robotId: string, key: string): Promise<string | null> {
  const { built } = await loadState(robotId);
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

export type ModelSource = OnshapeRef & { group: ModelGroup };

// The assemblies the model is built from: every system's assembly, as FRCBOM's Onshape panel
// links them (subsystems are drawn where their own assembly puts them). A robot without
// linked systems falls back to its main assembly.
async function modelSources(robotId: string): Promise<ModelSource[]> {
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
    } else sources.push({ ...ref, group: { systemIds: [r.id], name: r.name } });
  }
  if (sources.length) return sources;
  const [robot] = await db.select({ name: robots.name, url: robots.mainAssemblyUrl }).from(robots).where(eq(robots.id, robotId));
  const main = robot?.url ? parseOnshapeUrl(robot.url) : null;
  return main?.eid ? [{ ...main, group: { systemIds: [], name: robot.name } }] : [];
}

// One group's revision: where its assembly is read, and the workspace's microversion. A version
// or microversion never changes, so a pinned group's plan is read from Onshape once.
const groupRev = (ref: OnshapeRef, mv: string | undefined) => `${PLAN_VERSION}|${TESS_VERSION}|${ref.wvm}:${ref.wvmid}:${ref.eid}:${mv ?? ""}`;
const groupKey = (ref: OnshapeRef) => `${ref.did}:${ref.eid}`;

export async function buildRobotModel(robotId: string, memberId: string, deadline: number): Promise<BuildStep> {
  if (!storageConfigured()) throw new StorageNotConfiguredError();
  const sources = await modelSources(robotId);
  if (!sources.length) throw new OnshapeError("Link this robot's systems to their Onshape assemblies first.");
  const client = onshapeClient(memberId, sources[0].baseUrl);
  try {
    return await buildStep(robotId, client, sources, deadline);
  } finally {
    logCalls("3d-model", client);
  }
}

async function buildStep(robotId: string, client: OnshapeClient, sources: ModelSource[], deadline: number): Promise<BuildStep> {
  const state = await loadState(robotId);

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
    draft = mergePlans(sources, plans, rev);
    await saveState(robotId, { ...state, draft, plans });
  }

  // 3. Part Studio meshes, eight at a time.
  try {
    await runJobs(client, draft, deadline);
  } finally {
    await saveState(robotId, { ...state, draft, plans });
  }

  const done = draft.jobs.filter((j) => j.done).length;
  if (done < draft.jobs.length) return { state: "working", done, total: draft.jobs.length, calls: client.calls };

  const built: Built = {
    rev,
    builtAt: new Date().toISOString(),
    studios: draft.jobs.map((j) => j.key),
    placements: draft.placements,
    groups: draft.groups,
  };
  await saveState(robotId, { built, plans });
  return { state: "done", unchanged: false, parts: built.placements.length, calls: client.calls };
}

// The whole model, step after step, on the server (no time limit there since the move off
// Vercel): for work nobody watches in a browser, like a system linked from the Onshape panel.
export async function buildRobotModelFully(robotId: string, memberId: string, ms = 10 * 60_000): Promise<BuildStep> {
  const until = Date.now() + ms;
  for (;;) {
    const step = await buildRobotModel(robotId, memberId, Math.min(until, Date.now() + 150_000));
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
        const config = job.configuration ? `&configuration=${encodeURIComponent(job.configuration)}` : "";
        const link = job.linkDid ? `&linkDocumentId=${job.linkDid}` : "";
        const meshes = await studioMeshes(client, job.path, `${config}${link}`, job.state ?? null);
        await putObject(job.key, gzipSync(encodeMeshes(meshes)), "application/gzip");
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
async function planGroup(client: OnshapeClient, ref: ModelSource, rev: string): Promise<GroupPlan> {
  const jobs: Job[] = [];
  const jobIndex = new Map<string, number>();
  const placements: GroupPlan["placements"] = [];
  const names: Record<string, string> = {}; // part key → its instance name in Onshape
  const def = flattenAssembly(
    await client.json<AssemblyDefinition>(`assemblies/${apiPath(ref)}?includeMateFeatures=false&includeNonSolids=false&includeMateConnectors=false`),
  );
  const revisions = await studioRevisions(client, def.flatMap((p) => studioContext(p.studio, ref) ?? []));

  const jobFor = (s: StudioRef): number => {
    const own = s.did === ref.did && !s.version;
    const path = own
      ? `d/${s.did}/${ref.wvm}/${ref.wvmid}/e/${s.eid}`
      : s.version
        ? `d/${s.did}/v/${s.version}/e/${s.eid}`
        : s.microversion
          ? `d/${s.did}/m/${s.microversion}/e/${s.eid}`
          : apiPath({ ...ref, did: s.did, eid: s.eid });
    const context = studioContext(s, ref);
    const element = context ? revisions.get(contextKey(context))?.get(s.eid) : undefined;
    // Without its element revision, a frozen context still names one state; in a workspace the
    // group's revision does (re-exported whenever the assembly's document changes).
    const studioRev = element
      ? `e${element}`
      : s.version
        ? `v${s.version}`
        : s.microversion
          ? `m${s.microversion}`
          : own && ref.wvm !== "w"
            ? `${ref.wvm}${ref.wvmid}`
            : rev;
    const hash = createHash("sha1")
      .update(`${TESS_VERSION}|${studioRev}|${s.configuration ?? ""}`)
      .digest("hex")
      .slice(0, 20);
    const key = `models/studios/${s.did}/${s.eid}/${hash}.bin.gz`;
    let index = jobIndex.get(key);
    if (index === undefined) {
      index =
        jobs.push({
          key,
          path,
          ...(element ? { state: studioState(s.did, s.eid, element) } : {}),
          ...(s.configuration ? { configuration: s.configuration } : {}),
          ...(s.did !== ref.did ? { linkDid: ref.did } : {}),
        }) - 1;
      jobIndex.set(key, index);
    }
    return index;
  };

  for (const p of def) {
    const k = partKey(p.studio.did, p.studio.eid, p.partId);
    placements.push({ j: jobFor(p.studio), k, t: p.transform });
    if (p.name) names[k] = p.name;
  }
  return { rev, jobs, placements, names };
}

// The robot's plan from its groups' plans: each Part Studio file once, placements by group.
export function mergePlans(sources: { did: string; eid?: string; group: ModelGroup }[], plans: Record<string, GroupPlan>, rev: string): Draft {
  const jobs: Job[] = [];
  const jobIndex = new Map<string, number>();
  const placements: ModelPlacement[] = [];
  const names: Record<string, string> = {};
  sources.forEach((ref, g) => {
    const plan = plans[`${ref.did}:${ref.eid}`];
    const global = plan.jobs.map((job) => {
      let index = jobIndex.get(job.key);
      if (index === undefined) {
        index = jobs.push({ ...job, done: false }) - 1;
        jobIndex.set(job.key, index);
      }
      return index;
    });
    for (const p of plan.placements) placements.push({ s: global[p.j], k: p.k, t: p.t, g });
    Object.assign(names, plan.names);
  });
  return { rev, jobs, placements, groups: sources.map((s) => s.group), names };
}
