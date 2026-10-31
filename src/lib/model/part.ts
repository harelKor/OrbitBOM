import "server-only";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { studioPath } from "@/lib/onshape/parts";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { getObject, imageUrl, objectExists, putObject, StorageNotConfiguredError, storageConfigured } from "@/lib/storage/r2";
import { partKey } from "./assembly";
import { builtStudioFor, studioMeshes, TESS_VERSION } from "./build";
import { decodeMeshes, encodeMeshes, type Mesh } from "./mesh";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export class NeedsOnshapeError extends Error {}

// One part's 3D preview, as a one-placement viewer model. It reuses the robot model's Part
// Studio file when the model has the part (no Onshape calls); otherwise it exports just this
// part (1 call), kept in R2 per part revision when the part has one.
export async function partModel(partId: string, member: { id: string; onshapeConnected: boolean }) {
  if (!storageConfigured()) throw new StorageNotConfiguredError();
  const [row] = await db
    .select({ part: schema.parts, robotId: schema.systems.robotId, assemblyUrl: schema.systems.assemblyUrl })
    .from(schema.parts)
    .innerJoin(schema.systems, eq(schema.systems.id, schema.parts.systemId))
    .where(eq(schema.parts.id, partId));
  const part = row?.part;
  const path = part && studioPath(part);
  if (!row || !part || !path) return null;
  const key = partKey(part.sourceDid!, part.sourceEid!, part.onshapePartId!);
  const model = async (file: string) => ({ studios: [await imageUrl(file)], placements: [{ s: 0, k: key, t: IDENTITY }] });

  const built = await builtStudioFor(row.robotId, key);
  if (built) return model(built);

  const file = partModelFile(part);
  if (part.thumbnailRev && (await objectExists(file))) return model(file);

  const ref = row.assemblyUrl ? parseOnshapeUrl(row.assemblyUrl) : null;
  if (!ref) return null;
  if (!member.onshapeConnected) throw new NeedsOnshapeError("Connect your Onshape account first (Profile → Connect Onshape).");
  const client = onshapeClient(member.id, ref.baseUrl);
  const meshes = (await studioMeshes(client, path, `&partId=${encodeURIComponent(part.onshapePartId!)}`)).filter(
    (m) => m.partId === part.onshapePartId,
  );
  if (!meshes.length) throw new OnshapeError("Onshape sent no shape for this part.");
  await putObject(file, gzipSync(encodeMeshes(meshes)), "application/gzip");
  return model(file);
}

// A part's own mesh file, named by its thumbnail revision (storage clean-up keeps only this one).
export const partModelFile = (part: { id: string; thumbnailRev: string | null }) =>
  part.thumbnailRev
    ? `models/parts/${part.id}/${createHash("sha1").update(`${TESS_VERSION}|${part.thumbnailRev}`).digest("hex").slice(0, 20)}.bin.gz`
    : `models/parts/${part.id}/latest.bin.gz`;

// One part's mesh (Part Studio coordinates, metres) for flat layouts and DXFs. It reads the robot
// model's or the part's own preview file (no Onshape calls); only when neither has it, it exports
// the part once (1 call) and keeps that as the preview file. `frozen`: the Part Studio the part was
// released at, read when its shape has changed since (1 call, not kept).
export async function partMesh(
  row: { part: typeof schema.parts.$inferSelect; robotId: string; assemblyUrl: string | null },
  member: { id: string; onshapeConnected: boolean },
  frozen?: { studio: string; onshapePartId: string } | null,
): Promise<Mesh | null> {
  const { part } = row;
  const path = studioPath(part);
  if (!path) return null;
  const read = async (file: string, id: string) => {
    const res = await getObject(file);
    if (!res) return null;
    const raw = gunzipSync(new Uint8Array(await res.arrayBuffer()));
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    return decodeMeshes(buf).find((m) => m.partId === id) ?? null;
  };
  if (!frozen) {
    if (!storageConfigured()) throw new StorageNotConfiguredError();
    const own = partModelFile(part);
    if (part.thumbnailRev && (await objectExists(own))) {
      const m = await read(own, part.onshapePartId!);
      if (m) return m;
    }
    const built = await builtStudioFor(row.robotId, partKey(part.sourceDid!, part.sourceEid!, part.onshapePartId!));
    if (built) {
      const m = await read(built, part.onshapePartId!);
      if (m) return m;
    }
  }
  const ref = row.assemblyUrl ? parseOnshapeUrl(row.assemblyUrl) : null;
  if (!ref) return null;
  if (!member.onshapeConnected) throw new NeedsOnshapeError("Connect your Onshape account first (Profile → Connect Onshape).");
  const client = onshapeClient(member.id, ref.baseUrl);
  const id = frozen?.onshapePartId ?? part.onshapePartId!;
  const meshes = (await studioMeshes(client, frozen?.studio ?? path, `&partId=${encodeURIComponent(id)}`)).filter((m) => m.partId === id);
  if (!meshes.length) throw new OnshapeError("Onshape sent no shape for this part.");
  if (!frozen && storageConfigured()) await putObject(partModelFile(part), gzipSync(encodeMeshes(meshes)), "application/gzip");
  return meshes[0];
}
