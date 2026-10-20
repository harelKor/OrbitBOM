import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { studioPath } from "@/lib/onshape/parts";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { imageUrl, objectExists, putObject, StorageNotConfiguredError, storageConfigured } from "@/lib/storage/r2";
import { partKey } from "./assembly";
import { builtStudioFor, TESS_QUERY, TESS_VERSION } from "./build";
import { encodeMeshes, meshesFromTessellation, type Tessellation } from "./mesh";

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

  const file = part.thumbnailRev
    ? `models/parts/${part.id}/${createHash("sha1").update(`${TESS_VERSION}|${part.thumbnailRev}`).digest("hex").slice(0, 20)}.bin.gz`
    : `models/parts/${part.id}/latest.bin.gz`;
  if (part.thumbnailRev && (await objectExists(file))) return model(file);

  const ref = row.assemblyUrl ? parseOnshapeUrl(row.assemblyUrl) : null;
  if (!ref) return null;
  if (!member.onshapeConnected) throw new NeedsOnshapeError("Connect your Onshape account first (Profile → Connect Onshape).");
  const client = onshapeClient(member.id, ref.baseUrl);
  const tess = await client.json<Tessellation>(
    `partstudios/${path}/tessellatedfaces?${TESS_QUERY}&partId=${encodeURIComponent(part.onshapePartId!)}`,
  );
  const meshes = meshesFromTessellation(tess).filter((m) => m.partId === part.onshapePartId);
  if (!meshes.length) throw new OnshapeError("Onshape sent no shape for this part.");
  await putObject(file, gzipSync(encodeMeshes(meshes)), "application/gzip");
  return model(file);
}
