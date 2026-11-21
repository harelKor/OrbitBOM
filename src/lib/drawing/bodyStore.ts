import "server-only";
import { gunzipSync, gzipSync } from "node:zlib";
import { getObject, putObject, storageConfigured } from "@/lib/storage/r2";
import type { Body } from "./brep";
import { packBody, type PackedBody } from "./bodyPack";

// One file per part, replaced when its drawing is made again (Regenerate), so it always matches
// the saved drawing. A few tens of kB gzipped.
const bodyKey = (partId: string) => `drawings/${partId}/body.json.gz`;

export async function saveBody(partId: string, body: Body) {
  if (!storageConfigured()) return;
  await putObject(bodyKey(partId), gzipSync(JSON.stringify(packBody(body))), "application/gzip");
}

// Null when the drawing was made before bodies were kept (one Regenerate brings it).
export async function loadBody(partId: string): Promise<PackedBody | null> {
  if (!storageConfigured()) return null;
  const res = await getObject(bodyKey(partId));
  if (!res) return null;
  return JSON.parse(gunzipSync(new Uint8Array(await res.arrayBuffer())).toString());
}
