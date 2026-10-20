import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { onshapeClient, OnshapeError, type OnshapeClient } from "@/lib/onshape/client";
import { apiPath, onshapeUrl, parseOnshapeUrl } from "@/lib/onshape/url";
import { imageUrl, objectExists, putObject, StorageNotConfiguredError, storageConfigured } from "@/lib/storage/r2";
import { flattenAssembly, partKey, type AssemblyDefinition, type StudioRef } from "./assembly";
import { encodeMeshes, meshesFromTessellation, type Tessellation } from "./mesh";

const { robots, systems, onshapeCache } = schema;

// The robot's 3D model, built from its systems' assemblies in Onshape. One build step runs
// per request until `deadline` and the browser calls again until it's done:
//   1. change check: each assembly document's microversion (1 call each; stops if unchanged);
//   2. the assembly definitions: every part and where it sits (1 call per system);
//   3. one tessellation per Part Studio revision not already in R2 (1 call each). A Part
//      Studio's file is keyed by its own revision, so an edit re-exports only what changed.
// What's built is kept in onshape_cache under "robot-model:<robotId>"; nothing here runs
// while a page renders.

export const TESS_VERSION = "1"; // bump to re-export every mesh after changing the parameters below
export const TESS_QUERY = "angleTolerance=0.35&chordTolerance=0.0005&outputFacetNormals=false&outputVertexNormals=false";

export type ModelPlacement = { s: number; k: string; t: number[]; g?: number }; // studio index, part key, transform, group
// A group is one linked assembly: the systems that use it (usually one), for showing and
// hiding subsystems in the viewer. Models built before groups existed have none.
export type ModelGroup = { systemIds: string[]; name: string };
type Job = { key: string; path: string; configuration?: string; linkDid?: string; done?: boolean };
type Built = { rev: string; builtAt: string; studios: string[]; placements: ModelPlacement[]; groups?: ModelGroup[] };
type Draft = { rev: string; jobs: Job[]; placements: ModelPlacement[]; groups?: ModelGroup[] };
const PLAN_VERSION = "g1"; // bump when the plan's shape changes, so the next Update replans
type State = { built?: Built; draft?: Draft };

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

// The built model with short-lived links to its mesh files, for the viewer.
export async function robotModel(robotId: string) {
  const { built } = await loadState(robotId);
  if (!built || !storageConfigured()) return null;
  return {
    builtAt: built.builtAt,
    studios: await Promise.all(built.studios.map((key) => imageUrl(key))),
    placements: built.placements,
    groups: built.groups ?? [],
  };
}

// The R2 file of the robot model's Part Studio that holds this part, if the model has it.
export async function builtStudioFor(robotId: string, key: string): Promise<string | null> {
  const { built } = await loadState(robotId);
  const placement = built?.placements.find((p) => p.k === key);
  return placement ? built!.studios[placement.s] : null;
}

export type BuildStep =
  | { state: "done"; unchanged: boolean; parts: number; calls: number }
  | { state: "working"; done: number; total: number; calls: number };

type Source = NonNullable<ReturnType<typeof parseOnshapeUrl>> & { group: ModelGroup };

// The assemblies the model is built from: every system's assembly, as FRCBOM's Onshape panel
// links them (subsystems are drawn where their own assembly puts them). A robot without
// linked systems falls back to its main assembly.
async function modelSources(robotId: string): Promise<Source[]> {
  const rows = await db
    .select({ id: systems.id, name: systems.name, url: systems.assemblyUrl })
    .from(systems)
    .where(eq(systems.robotId, robotId))
    .orderBy(asc(systems.createdAt));
  const sources: Source[] = [];
  for (const r of rows) {
    const ref = r.url ? parseOnshapeUrl(r.url) : null;
    if (!ref?.eid) continue;
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

export async function buildRobotModel(robotId: string, memberId: string, deadline: number): Promise<BuildStep> {
  if (!storageConfigured()) throw new StorageNotConfiguredError();
  const sources = await modelSources(robotId);
  if (!sources.length) throw new OnshapeError("Link this robot's systems to their Onshape assemblies first.");
  const client = onshapeClient(memberId, sources[0].baseUrl);
  const state = await loadState(robotId);

  // 1. Change check: one microversion call per workspace document. Version links never change.
  const mvs = new Map<string, string>();
  for (const ref of sources) {
    if (ref.wvm !== "w" || mvs.has(ref.wvmid)) continue;
    const mv = await client.json<{ microversion: string }>(`documents/d/${ref.did}/w/${ref.wvmid}/currentmicroversion`);
    mvs.set(ref.wvmid, mv.microversion);
  }
  const rev = [PLAN_VERSION, ...sources.map((ref) => `${ref.wvm}:${ref.wvmid}:${ref.eid}:${mvs.get(ref.wvmid) ?? ""}:${ref.group.systemIds.join(",")}`)].join("|");
  if (state.built?.rev === rev) {
    return { state: "done", unchanged: true, parts: state.built.placements.length, calls: client.calls };
  }

  // 2. Where every part sits, and which Part Studio files that needs.
  let draft = state.draft?.rev === rev ? state.draft : undefined;
  if (!draft) {
    draft = await planModel(client, sources, rev);
    await saveState(robotId, { ...state, draft });
  }

  // 3. Part Studio meshes, a few at a time. A job only starts while there is time left to
  // finish it inside the request; the rest waits for the browser's next call.
  const queue = draft.jobs.filter((j) => !j.done);
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (Date.now() > deadline) return;
      if (!(await objectExists(job.key))) {
        const config = job.configuration ? `&configuration=${encodeURIComponent(job.configuration)}` : "";
        const link = job.linkDid ? `&linkDocumentId=${job.linkDid}` : "";
        const tess = await client.json<Tessellation>(`partstudios/${job.path}/tessellatedfaces?${TESS_QUERY}${config}${link}`);
        await putObject(job.key, gzipSync(encodeMeshes(meshesFromTessellation(tess))), "application/gzip");
      }
      job.done = true;
    }
  };
  try {
    await Promise.all(Array.from({ length: 4 }, worker));
  } finally {
    await saveState(robotId, { ...state, draft });
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
  await saveState(robotId, { built });
  return { state: "done", unchanged: false, parts: built.placements.length, calls: client.calls };
}

async function planModel(client: OnshapeClient, sources: Source[], rev: string): Promise<Draft> {
  const jobs: Job[] = [];
  const jobIndex = new Map<string, number>();
  const placements: ModelPlacement[] = [];
  const elementRevs = new Map<string, Map<string, string>>(); // workspace → element → microversion

  for (const [g, ref] of sources.entries()) {
    const def = await client.json<AssemblyDefinition>(
      `assemblies/${apiPath(ref)}?includeMateFeatures=false&includeNonSolids=false&includeMateConnectors=false`,
    );
    const placed = flattenAssembly(def);

    // Part Studios in the assembly's own workspace are keyed by their element microversion
    // (1 call per document), so editing one Part Studio doesn't re-export the rest.
    let elementRev = elementRevs.get(ref.wvmid);
    if (!elementRev && ref.wvm === "w" && placed.some((p) => p.studio.did === ref.did && !p.studio.version)) {
      const elements = await client.json<{ id: string; microversionId?: string }[]>(
        `documents/d/${ref.did}/w/${ref.wvmid}/elements?elementType=PARTSTUDIO&withThumbnails=false`,
      );
      elementRev = new Map(elements.flatMap((e) => (e.microversionId ? [[e.id, e.microversionId] as const] : [])));
      elementRevs.set(ref.wvmid, elementRev);
    }

    const jobFor = (s: StudioRef): number => {
      let path: string;
      let studioRev: string;
      const own = s.did === ref.did && !s.version && elementRev?.get(s.eid);
      if (own) {
        path = `d/${s.did}/w/${ref.wvmid}/e/${s.eid}`;
        studioRev = `e${own}`;
      } else if (s.version) {
        path = `d/${s.did}/v/${s.version}/e/${s.eid}`;
        studioRev = `v${s.version}`;
      } else if (s.microversion) {
        path = `d/${s.did}/m/${s.microversion}/e/${s.eid}`;
        studioRev = `m${s.microversion}`;
      } else {
        path = apiPath({ ...ref, did: s.did, eid: s.eid });
        studioRev = rev;
      }
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
            ...(s.configuration ? { configuration: s.configuration } : {}),
            ...(s.did !== ref.did ? { linkDid: ref.did } : {}),
          }) - 1;
        jobIndex.set(key, index);
      }
      return index;
    };

    for (const p of placed) placements.push({ s: jobFor(p.studio), k: partKey(p.studio.did, p.studio.eid, p.partId), t: p.transform, g });
  }
  return { rev, jobs, placements, groups: sources.map((s) => s.group) };
}
