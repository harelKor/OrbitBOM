import "server-only";
import { schema } from "@/db";
import { onshapeClient } from "@/lib/onshape/client";
import { EXPORT_FORMATS, exportPart, type ExportFormat } from "@/lib/onshape/export";
import { studioPath } from "@/lib/onshape/parts";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { getObject, objectExists, putObject, storageConfigured } from "@/lib/storage/r2";
import { PlateDxfError, plateDxf } from "@/lib/drawing/plateDxf";
import { NeedsOnshapeError } from "@/lib/model/part";

export type PartRow = { part: typeof schema.parts.$inferSelect; assemblyUrl: string | null; robotId: string };

// Why a part can't be exported in a format (shown to the member as is).
export class PartFileError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

// A part's CAD export (not the plate DXF, see plateDxf.ts): its file name and the R2 key it is
// cached under per part revision. `fab`: the state it was released at, when it was locked
// (plan/fab-version-lock.md).
export function partFileTarget(row: PartRow, format: ExportFormat, fab: boolean) {
  const lock = fab && row.part.releasedSnapshot?.studio && row.part.releasedSnapshot.onshapePartId ? row.part.releasedSnapshot : null;
  const studio = lock ? lock.studio : studioPath(row.part);
  const ref = row.assemblyUrl ? parseOnshapeUrl(row.assemblyUrl) : null;
  if (!studio || !ref) throw new PartFileError("This part isn't from Onshape.", 400);

  const flat = format.endsWith("_FLAT");
  const flatPartId = lock ? lock.flatPartId : row.part.geometry?.sheetMetal?.flatPartId;
  const onshapePartId = lock ? lock.onshapePartId! : row.part.onshapePartId!;
  const rev = lock ? lock.thumbnailRev : row.part.thumbnailRev;
  if (flat && !flatPartId) throw new PartFileError("This part isn't Onshape sheet metal, so it has no flat pattern.", 400);

  const { ext, type } = EXPORT_FORMATS[format];
  const name = (row.part.displayName ?? row.part.onshapeName ?? "part").replace(/[^\w.\- ]+/g, "_");
  const wall = row.part.geometry?.wallMm;
  const suffix = flat ? ` (flat${wall ? ` ${wall}mm` : ""})` : "";
  const filename = `${row.part.partNumber ? `${row.part.partNumber} ` : ""}${name}${suffix}.${ext}`;
  const key = rev ? `exports/${row.part.id}/${rev}${flat ? ".flat" : ""}.${ext}` : null;
  return { studio, ref, partId: flat ? flatPartId! : onshapePartId, format, type, ext, filename, key };
}

// Makes sure the export is in R2 (one Onshape export when it isn't yet). Returns the bytes only
// when they weren't stored (no R2, or no revision to key them by).
export async function ensurePartFile(
  target: ReturnType<typeof partFileTarget>,
  member: { id: string; onshapeConnected: boolean },
  deadline: number,
): Promise<{ cached: true } | { cached: false; body: ArrayBuffer }> {
  if (storageConfigured() && target.key && (await objectExists(target.key))) return { cached: true };
  if (!member.onshapeConnected) throw new PartFileError("Connect your Onshape account first (Profile → Connect Onshape).", 403);
  const client = onshapeClient(member.id, target.ref.baseUrl);
  const body = await exportPart(client, target.studio, target.partId, target.format, deadline);
  if (!storageConfigured() || !target.key) return { cached: false, body };
  await putObject(target.key, body, target.type);
  return { cached: true };
}

// The export's bytes, from R2 when cached. A sheet metal flat DXF is drawn in the app from its flat
// pattern (Onshape won't translate one), like a plate's.
export async function partFileBytes(row: PartRow, format: ExportFormat, fab: boolean, member: { id: string; onshapeConnected: boolean }, deadline: number) {
  const target = partFileTarget(row, format, fab);
  if (format === "DXF_FLAT") {
    try {
      return { filename: target.filename, ext: target.ext, bytes: new TextEncoder().encode(await plateDxf(row, member, fab, deadline)) };
    } catch (err) {
      if (err instanceof PlateDxfError) throw new PartFileError(err.message, err.status);
      if (err instanceof NeedsOnshapeError) throw new PartFileError(err.message, 403);
      throw err;
    }
  }
  const got = await ensurePartFile(target, member, deadline);
  if (!got.cached) return { filename: target.filename, ext: target.ext, bytes: new Uint8Array(got.body) };
  const res = await getObject(target.key!);
  if (!res) throw new PartFileError("The stored export is missing. Try again.", 502);
  return { filename: target.filename, ext: target.ext, bytes: new Uint8Array(await res.arrayBuffer()) };
}
