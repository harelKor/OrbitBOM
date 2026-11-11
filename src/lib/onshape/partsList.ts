import "server-only";
import type { OnshapeClient } from "./client";
import { cachedPayloads, keepPayload } from "./studioRevs";

// A Part Studio's parts list (1 call): each part's body type, its sheet metal flat pattern and
// its appearance. Read by the BOM's part data (sheet metal for the export files, body type) and
// by the 3D model (colours the tessellation left out), and kept under the Part Studio's revision
// (studioRevs.ts), so the two never ask Onshape for the same list (plan/onshape-calls.md).

export type ListedPart = { partId: string; bodyType?: string; isFlattenedBody?: boolean; unflattenedPartId?: string; appearance?: unknown };

// `state`: the Part Studio's revision name, null when unknown (then nothing is kept).
// `extra`: the query's tail ("&configuration=…&linkDocumentId=…").
export async function partsList(client: OnshapeClient, path: string, state: string | null, extra = ""): Promise<ListedPart[]> {
  const config = /[?&]configuration=([^&]*)/.exec(extra)?.[1] ?? "";
  const key = state ? `parts-list:${state}${config ? `:${config}` : ""}` : null;
  if (key) {
    const kept = (await cachedPayloads<ListedPart[]>([key])).get(key);
    if (kept) return kept;
  }
  const raw = await client.json<ListedPart[]>(`parts/${path}?withThumbnails=false&includeFlatParts=true${extra}`);
  const list = raw.map(({ partId, bodyType, isFlattenedBody, unflattenedPartId, appearance }) => ({ partId, bodyType, isFlattenedBody, unflattenedPartId, appearance }));
  if (key) await keepPayload(key, list);
  return list;
}
