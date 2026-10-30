import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { EXPORT_FORMATS, exportPart, isExportFormat } from "@/lib/onshape/export";
import { studioPath } from "@/lib/onshape/parts";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { objectExists, presignDownload, putObject, storageConfigured } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";

export const maxDuration = 60;

// Download a part as STEP, STL, Parasolid or, for sheet metal, its flat pattern (?format=). Exports
// are cached in R2 per part revision, so a second download of an unchanged part costs no Onshape
// calls.
export async function GET(request: Request, { params }: { params: Promise<{ partId: string }> }) {
  const started = Date.now();
  const member = await getMember();
  if (!member) return new NextResponse("Sign in first.", { status: 401 });
  const { partId } = await params;
  const search = new URL(request.url).searchParams;
  const format = search.get("format") ?? "";
  if (!isUuid(partId) || !isExportFormat(format)) return new NextResponse("Unknown part or format.", { status: 400 });

  const [row] = await db
    .select({ part: schema.parts, assemblyUrl: schema.systems.assemblyUrl })
    .from(schema.parts)
    .innerJoin(schema.systems, eq(schema.systems.id, schema.parts.systemId))
    .where(eq(schema.parts.id, partId));
  // ?fab=1 (To Fab): the state the part was released at, when it was locked (plan/fab-version-lock.md).
  const lock = search.get("fab") === "1" && row?.part.releasedSnapshot?.studio && row.part.releasedSnapshot.onshapePartId ? row.part.releasedSnapshot : null;
  const studio = lock ? lock.studio : row && studioPath(row.part);
  const ref = row?.assemblyUrl ? parseOnshapeUrl(row.assemblyUrl) : null;
  if (!studio || !ref) return new NextResponse("This part isn't from Onshape.", { status: 400 });

  const flat = format.endsWith("_FLAT");
  const flatPartId = lock ? lock.flatPartId : row.part.geometry?.sheetMetal?.flatPartId;
  const onshapePartId = lock ? lock.onshapePartId! : row.part.onshapePartId!;
  const rev = lock ? lock.thumbnailRev : row.part.thumbnailRev;
  if (flat && !flatPartId) return new NextResponse("This part isn't Onshape sheet metal, so it has no flat pattern.", { status: 400 });

  const { ext, type } = EXPORT_FORMATS[format];
  const name = (row.part.displayName ?? row.part.onshapeName ?? "part").replace(/[^\w.\- ]+/g, "_");
  const wall = row.part.geometry?.wallMm;
  const suffix = flat ? ` (flat${wall ? ` ${wall}mm` : ""})` : "";
  const filename = `${row.part.partNumber ? `${row.part.partNumber} ` : ""}${name}${suffix}.${ext}`;
  const key = rev ? `exports/${partId}/${rev}${flat ? ".flat" : ""}.${ext}` : null;

  const cached = storageConfigured() && key && (await objectExists(key));
  if (!cached) {
    if (!member.onshapeConnected) {
      return new NextResponse("Connect your Onshape account first (Profile → Connect Onshape).", { status: 403 });
    }
    try {
      const client = onshapeClient(member.id, ref.baseUrl);
      const body = await exportPart(client, studio, flat ? flatPartId! : onshapePartId, format, started + 50_000);
      if (!storageConfigured() || !key) {
        return new NextResponse(body, {
          headers: { "content-type": type, "content-disposition": `attachment; filename="${filename}"` },
        });
      }
      await putObject(key, body, type);
    } catch (err) {
      if (err instanceof OnshapeError) return new NextResponse(err.message, { status: 502 });
      throw err;
    }
  }
  return NextResponse.redirect(await presignDownload(key!, filename, false));
}
