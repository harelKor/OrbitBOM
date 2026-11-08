import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { OnshapeClient } from "@/lib/onshape/client";
import type { OnshapeVersion } from "@/lib/reviews/tree";

const { onshapeCache } = schema;

// A document's Onshape versions, kept for the CAD Review version tree. Read in the one call a
// system that follows versions makes on every check anyway, or with the tree's Refresh (1 call):
// the tree page itself never calls Onshape.
export const docVersionsKey = (did: string) => `doc-versions:${did}`;

type Raw = { id: string; name?: string; createdAt?: string; description?: string; creator?: { name?: string } };

export async function keepDocVersions(did: string, list: Raw[]) {
  const versions: OnshapeVersion[] = list
    .filter((v) => v.id && v.createdAt)
    .map((v) => ({ id: v.id, name: v.name ?? "", createdAt: v.createdAt!, creator: v.creator?.name ?? null, description: v.description || null }));
  const payload = { versions };
  await db
    .insert(onshapeCache)
    .values({ key: docVersionsKey(did), payload })
    .onConflictDoUpdate({ target: onshapeCache.key, set: { payload, fetchedAt: new Date() } });
  return versions;
}

export async function readDocVersions(client: OnshapeClient, did: string) {
  const list = await client.json<Raw[]>(`documents/d/${did}/versions`);
  await keepDocVersions(did, list);
  return list;
}

export async function keptDocVersions(did: string): Promise<{ versions: OnshapeVersion[]; at: Date } | null> {
  const [row] = await db.select({ payload: onshapeCache.payload, at: onshapeCache.fetchedAt }).from(onshapeCache).where(eq(onshapeCache.key, docVersionsKey(did)));
  return row ? { versions: (row.payload as { versions: OnshapeVersion[] }).versions, at: row.at } : null;
}
