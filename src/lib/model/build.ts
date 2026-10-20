import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { onshapeClient, OnshapeError, type OnshapeClient } from "@/lib/onshape/client";
import { apiPath, parseOnshapeUrl } from "@/lib/onshape/url";
import { imageUrl, objectExists, putObject, StorageNotConfiguredError, storageConfigured } from "@/lib/storage/r2";
import { flattenAssembly, partKey, type AssemblyDefinition, type StudioRef } from "./assembly";
import { encodeMeshes, meshesFromTessellation, type Tessellation } from "./mesh";

const { robots, onshapeCache } = schema;

// The robot's 3D model, built from its main assembly in Onshape. One build step runs per
// request until `deadline` and the browser calls again until it's done:
//   1. change check: the assembly document's microversion (1 call; stops here if unchanged);
//   2. the assembly definition: every part and where it sits (1 call);
//   3. one tessellation per Part Studio revision not already in R2 (1 call each). A Part
//      Studio's file is keyed by its own revision, so an edit re-exports only what changed.
// What's built is kept in onshape_cache under "robot-model:<robotId>"; nothing here runs
// while a page renders.

const TESS_VERSION = "1"; // bump to re-export every mesh after changing the parameters below
const TESS_QUERY = "angleTolerance=0.35&chordTolerance=0.0005&outputFacetNormals=false&outputVertexNormals=false";

export type ModelPlacement = { s: number; k: string; t: number[] }; // studio index, part key, transform
type Job = { key: string; path: string; configuration?: string; done?: boolean };
type Built = { rev: string; builtAt: string; studios: string[]; placements: ModelPlacement[] };
type Draft = { rev: string; jobs: Job[]; placements: ModelPlacement[] };
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
  };
}

export type BuildStep =
  | { state: "done"; unchanged: boolean; parts: number; calls: number }
  | { state: "working"; done: number; total: number; calls: number };

export async function buildRobotModel(robotId: string, memberId: string, deadline: number): Promise<BuildStep> {
  if (!storageConfigured()) throw new StorageNotConfiguredError();
  const [robot] = await db.select().from(robots).where(eq(robots.id, robotId));
  const ref = robot?.mainAssemblyUrl ? parseOnshapeUrl(robot.mainAssemblyUrl) : null;
  if (!ref?.eid) throw new OnshapeError("Add the robot's main assembly link in robot settings first.");
  const client = onshapeClient(memberId, ref.baseUrl);
  const state = await loadState(robotId);

  // 1. Change check. A version or microversion link never changes.
  let rev = `${ref.wvm}:${ref.wvmid}:${ref.eid}`;
  if (ref.wvm === "w") {
    const mv = await client.json<{ microversion: string }>(`documents/d/${ref.did}/w/${ref.wvmid}/currentmicroversion`);
    rev += `:${mv.microversion}`;
  }
  if (state.built?.rev === rev) {
    return { state: "done", unchanged: true, parts: state.built.placements.length, calls: client.calls };
  }

  // 2. Where every part sits, and which Part Studio files that needs.
  let draft = state.draft?.rev === rev ? state.draft : undefined;
  if (!draft) {
    draft = await planModel(client, ref, rev);
    await saveState(robotId, { ...state, draft });
  }

  // 3. Part Studio meshes, a few at a time.
  const queue = draft.jobs.filter((j) => !j.done);
  const linkDid = ref.did;
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (Date.now() > deadline) return;
      if (!(await objectExists(job.key))) {
        const config = job.configuration ? `&configuration=${encodeURIComponent(job.configuration)}` : "";
        const tess = await client.json<Tessellation>(
          `partstudios/${job.path}/tessellatedfaces?${TESS_QUERY}${config}&linkDocumentId=${linkDid}`,
        );
        await putObject(job.key, gzipSync(encodeMeshes(meshesFromTessellation(tess))), "application/gzip");
      }
      job.done = true;
    }
  };
  try {
    await Promise.all(Array.from({ length: 3 }, worker));
  } finally {
    await saveState(robotId, { ...state, draft });
  }

  const done = draft.jobs.filter((j) => j.done).length;
  if (done < draft.jobs.length) return { state: "working", done, total: draft.jobs.length, calls: client.calls };

  const built: Built = { rev, builtAt: new Date().toISOString(), studios: draft.jobs.map((j) => j.key), placements: draft.placements };
  await saveState(robotId, { built });
  return { state: "done", unchanged: false, parts: built.placements.length, calls: client.calls };
}

async function planModel(client: OnshapeClient, ref: NonNullable<ReturnType<typeof parseOnshapeUrl>>, rev: string): Promise<Draft> {
  const def = await client.json<AssemblyDefinition>(
    `assemblies/${apiPath(ref)}?includeMateFeatures=false&includeNonSolids=false&includeMateConnectors=false`,
  );
  const placed = flattenAssembly(def);

  // Part Studios in the assembly's own workspace are keyed by their element microversion
  // (1 call for the whole document), so editing one Part Studio doesn't re-export the rest.
  const elementRev = new Map<string, string>();
  if (ref.wvm === "w" && placed.some((p) => p.studio.did === ref.did && !p.studio.version)) {
    const elements = await client.json<{ id: string; microversionId?: string }[]>(
      `documents/d/${ref.did}/w/${ref.wvmid}/elements?elementType=PARTSTUDIO&withThumbnails=false`,
    );
    for (const e of elements) if (e.microversionId) elementRev.set(e.id, e.microversionId);
  }

  const jobs: Job[] = [];
  const jobIndex = new Map<string, number>();
  const jobFor = (s: StudioRef): number => {
    let path: string;
    let studioRev: string;
    const own = s.did === ref.did && !s.version && elementRev.get(s.eid);
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
      index = jobs.push({ key, path, ...(s.configuration ? { configuration: s.configuration } : {}) }) - 1;
      jobIndex.set(key, index);
    }
    return index;
  };

  const placements = placed.map((p) => ({ s: jobFor(p.studio), k: partKey(p.studio.did, p.studio.eid, p.partId), t: p.transform }));
  return { rev, jobs, placements };
}
