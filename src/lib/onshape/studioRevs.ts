import "server-only";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { OnshapeError, type OnshapeClient } from "./client";
import type { WVM } from "./url";

const { onshapeCache } = schema;

// Each Part Studio's own revision (its element microversion), so what Onshape answers about a
// Part Studio can be kept under the state it was read at and never asked again (plan/onshape-calls.md):
// shape fingerprints, parts lists and 3D meshes. One elements call per document context gives
// every Part Studio in it; a version or microversion never changes, so its list is kept and costs
// nothing the next time. A workspace is read each time (1 call), however many Part Studios it has.

export type StudioContext = { did: string; wvm: WVM; wvmid: string };
export const contextKey = (c: StudioContext) => `${c.did}:${c.wvm}:${c.wvmid}`;

// "d/<did>/<wvm>/<wvmid>/e/<eid>" → its context and element.
export function parseStudioPath(path: string): { context: StudioContext; eid: string } | null {
  const m = /^d\/([^/]+)\/([wvm])\/([^/]+)\/e\/([^/?]+)/.exec(path);
  return m ? { context: { did: m[1], wvm: m[2] as WVM, wvmid: m[3] }, eid: m[4] } : null;
}

// The name of one Part Studio state, the same whichever context it's read in.
export const studioState = (did: string, eid: string, rev: string) => `${did}/${eid}@e${rev}`;

export async function studioRevisions(client: OnshapeClient, contexts: StudioContext[]): Promise<Map<string, Map<string, string>>> {
  const unique = [...new Map(contexts.map((c) => [contextKey(c), c])).values()];
  const keyOf = (c: StudioContext) => `element-revs:${contextKey(c)}`;
  const frozen = unique.filter((c) => c.wvm !== "w").map(keyOf);
  const cached = new Map<string, Record<string, string>>(
    frozen.length ? (await db.select().from(onshapeCache).where(inArray(onshapeCache.key, frozen))).map((r) => [r.key, r.payload as Record<string, string>]) : [],
  );
  const out = new Map<string, Map<string, string>>();
  await Promise.all(
    unique.map(async (c) => {
      let revs = c.wvm !== "w" ? cached.get(keyOf(c)) : undefined;
      if (!revs) {
        try {
          const elements = await client.json<{ id: string; microversionId?: string }[]>(
            `documents/d/${c.did}/${c.wvm}/${c.wvmid}/elements?elementType=PARTSTUDIO&withThumbnails=false`,
          );
          revs = Object.fromEntries((Array.isArray(elements) ? elements : []).flatMap((e) => (e.microversionId ? [[e.id, e.microversionId]] : [])));
          if (c.wvm !== "w") await db.insert(onshapeCache).values({ key: keyOf(c), payload: revs }).onConflictDoNothing();
        } catch (err) {
          if (!(err instanceof OnshapeError)) throw err;
          revs = {};
        }
      }
      out.set(contextKey(c), new Map(Object.entries(revs)));
    }),
  );
  return out;
}

// Each studio path's state name (null when Onshape didn't give its revision).
export async function studioStates(client: OnshapeClient, paths: Iterable<string>): Promise<Map<string, string | null>> {
  const parsed = [...new Set(paths)].map((path) => ({ path, p: parseStudioPath(path) }));
  const revs = await studioRevisions(client, parsed.flatMap(({ p }) => (p ? [p.context] : [])));
  return new Map(
    parsed.map(({ path, p }) => {
      const rev = p && revs.get(contextKey(p.context))?.get(p.eid);
      return [path, p && rev ? studioState(p.context.did, p.eid, rev) : null];
    }),
  );
}

// Kept answers by key, in one read.
export async function cachedPayloads<T>(keys: string[]): Promise<Map<string, T>> {
  if (!keys.length) return new Map();
  const rows = await db.select({ key: onshapeCache.key, payload: onshapeCache.payload }).from(onshapeCache).where(inArray(onshapeCache.key, [...new Set(keys)]));
  return new Map(rows.map((r) => [r.key, r.payload as T]));
}

export async function keepPayload(key: string, payload: unknown) {
  await db
    .insert(onshapeCache)
    .values({ key, payload })
    .onConflictDoUpdate({ target: onshapeCache.key, set: { payload, fetchedAt: new Date() } });
}
