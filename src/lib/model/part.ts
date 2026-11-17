import "server-only";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { logCalls, onshapeClient, OnshapeError } from "@/lib/onshape/client";
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
  // `keys`: the file's R2 key when it names one revision, so the browser keeps it and the next
  // opening downloads nothing (src/components/viewer/meshCache.ts); "latest" files can change.
  const model = async (file: string, kept: boolean) => ({ studios: [await imageUrl(file)], keys: [kept ? file : null], placements: [{ s: 0, k: key, t: IDENTITY }] });

  const built = await builtStudioFor(row.robotId, key);
  if (built) return model(built, true);

  const file = partModelFile(part);
  if (part.thumbnailRev && (await objectExists(file))) return model(file, true);

  const ref = row.assemblyUrl ? parseOnshapeUrl(row.assemblyUrl) : null;
  if (!ref) return null;
  if (!member.onshapeConnected) throw new NeedsOnshapeError("Connect your Onshape account first (Profile → Connect Onshape).");
  const client = onshapeClient(member.id, ref.baseUrl);
  const meshes = (await studioMeshes(client, path, `&partId=${encodeURIComponent(part.onshapePartId!)}`)).filter(
    (m) => m.partId === part.onshapePartId,
  );
  if (!meshes.length) throw new OnshapeError("Onshape sent no shape for this part.");
  await putObject(file, gzipSync(encodeMeshes(meshes)), "application/gzip");
  return model(file, !!part.thumbnailRev);
}

// A part's own mesh file, named by its thumbnail revision (storage clean-up keeps only this one).
export const partModelFile = (part: { id: string; thumbnailRev: string | null }) =>
  part.thumbnailRev
    ? `models/parts/${part.id}/${createHash("sha1").update(`${TESS_VERSION}|${part.thumbnailRev}`).digest("hex").slice(0, 20)}.bin.gz`
    : `models/parts/${part.id}/latest.bin.gz`;

// An Onshape sheet metal part's flat pattern: the state released to fab when `fab` and the part is
// locked there (flat body ids differ between versions), else the live one.
export function flatSource(part: typeof schema.parts.$inferSelect, fab: boolean) {
  const lock = fab && part.releasedSnapshot?.studio && part.releasedSnapshot.onshapePartId ? part.releasedSnapshot : null;
  const flatPartId = lock ? lock.flatPartId : (part.geometry?.sheetMetal?.flatPartId ?? null);
  const studio = lock ? lock.studio : studioPath(part);
  if (!flatPartId || !studio) return null;
  return { studio, flatPartId, rev: lock ? lock.thumbnailRev : part.thumbnailRev };
}

// Its mesh file in R2, one per revision and flat body.
export const flatModelFile = (part: { id: string }, src: NonNullable<ReturnType<typeof flatSource>>) =>
  `models/parts/${part.id}/${createHash("sha1").update(`${TESS_VERSION}|flat|${src.rev ?? "none"}|${src.studio}|${src.flatPartId}`).digest("hex").slice(0, 20)}.flat.bin.gz`;

// The flat pattern's mesh (Part Studio coordinates, metres; it lies on z = 0 at the sheet's
// thickness). Auto Layout nests it and the part's flat DXF is drawn from it, because Onshape won't
// translate a flat body to DXF or put one in an assembly (plan/sheet-metal-flatten.md, spike
// 2026-11-04). One Onshape call per revision, then kept in R2. `cachedOnly`: never call Onshape
// (null when it isn't stored yet).
export async function flatMesh(
  row: { part: typeof schema.parts.$inferSelect; assemblyUrl: string | null },
  member: { id: string; onshapeConnected: boolean } | null,
  { fab, cachedOnly = false }: { fab: boolean; cachedOnly?: boolean },
): Promise<{ mesh: Mesh; file: string; flatPartId: string } | null> {
  const src = flatSource(row.part, fab);
  if (!src) return null;
  if (!storageConfigured()) throw new StorageNotConfiguredError();
  const file = flatModelFile(row.part, src);
  const res = (await objectExists(file)) ? await getObject(file) : null;
  if (res) {
    const raw = gunzipSync(new Uint8Array(await res.arrayBuffer()));
    const mesh = decodeMeshes(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer).find((m) => m.partId === src.flatPartId);
    if (mesh) return { mesh, file, flatPartId: src.flatPartId };
  }
  if (cachedOnly) return null;
  const ref = row.assemblyUrl ? parseOnshapeUrl(row.assemblyUrl) : null;
  if (!ref) return null;
  if (!member?.onshapeConnected) throw new NeedsOnshapeError("Connect your Onshape account first (Profile → Connect Onshape).");
  const client = onshapeClient(member.id, ref.baseUrl);
  const meshes = (await studioMeshes(client, src.studio, `&partId=${encodeURIComponent(src.flatPartId)}`).finally(() => logCalls("flat-pattern", client))).filter(
    (m) => m.partId === src.flatPartId,
  );
  if (!meshes.length) throw new OnshapeError("Onshape sent no flat pattern for this part.");
  await putObject(file, gzipSync(encodeMeshes(meshes)), "application/gzip");
  return { mesh: meshes[0], file, flatPartId: src.flatPartId };
}

const partRow = async (partId: string) => {
  const [row] = await db
    .select({ part: schema.parts, robotId: schema.systems.robotId, assemblyUrl: schema.systems.assemblyUrl })
    .from(schema.parts)
    .innerJoin(schema.systems, eq(schema.systems.id, schema.parts.systemId))
    .where(eq(schema.parts.id, partId));
  return row ?? null;
};

// Whether a sheet metal part's flat pattern is already kept in R2, so opening it costs no Onshape
// calls (the part window's Open flatten shows that in its cost hint). Never calls Onshape.
export async function flatCached(partId: string): Promise<boolean> {
  if (!storageConfigured()) return false;
  const row = await partRow(partId);
  const src = row && flatSource(row.part, false);
  return !!src && (await objectExists(flatModelFile(row.part, src)));
}

// A sheet metal part's flat pattern as a one-placement viewer model, for the part window's Open
// flatten (Harel, 2026-11-17). The same R2 file as its flat DXF and Auto Layout (flatMesh), so
// whichever comes first pays the one Onshape call and the others read it. null: not sheet metal.
export async function flatModel(partId: string, member: { id: string; onshapeConnected: boolean }) {
  if (!storageConfigured()) throw new StorageNotConfiguredError();
  const row = await partRow(partId);
  const src = row && flatSource(row.part, false);
  if (!row || !src) return null;
  const file = flatModelFile(row.part, src);
  if (!(await objectExists(file)) && !(await flatMesh(row, member, { fab: false }))) return null;
  // The viewer finds the mesh by the key's last part (the flat body's id).
  const key = partKey(row.part.sourceDid!, row.part.sourceEid!, src.flatPartId);
  // Kept by the browser only when the file names one revision (src.rev); "none" files can change.
  return { studios: [await imageUrl(file)], keys: [src.rev ? file : null], placements: [{ s: 0, k: key, t: IDENTITY }] };
}

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
