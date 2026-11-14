import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { OnshapeError } from "@/lib/onshape/client";
import { isExportFormat } from "@/lib/onshape/export";
import { ensurePartFile, PartFileError, partFileTarget } from "@/lib/onshape/partFile";
import { presignDownload, storageConfigured } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";
import { PlateDxfError, plateDxf, plateDxfKey, plateDxfName } from "@/lib/drawing/plateDxf";
import { NeedsOnshapeError } from "@/lib/model/part";
import { contentDisposition } from "@/lib/http/disposition";

export const maxDuration = 60;

// Download a part as STEP, STL, Parasolid, a plate's flat DXF or, for sheet metal, its flat
// pattern (?format=). Exports are cached in R2 per part revision, so a second download of an
// unchanged part costs no Onshape calls. The plate DXF is made from the part's cached mesh.
export async function GET(request: Request, { params }: { params: Promise<{ partId: string }> }) {
  const started = Date.now();
  const member = await getMember();
  if (!member) return new NextResponse("Sign in first.", { status: 401 });
  const { partId } = await params;
  const search = new URL(request.url).searchParams;
  const format = search.get("format") ?? "";
  if (!isUuid(partId) || !isExportFormat(format)) return new NextResponse("Unknown part or format.", { status: 400 });

  const [row] = await db
    .select({ part: schema.parts, assemblyUrl: schema.systems.assemblyUrl, robotId: schema.systems.robotId })
    .from(schema.parts)
    .innerJoin(schema.systems, eq(schema.systems.id, schema.parts.systemId))
    .where(eq(schema.parts.id, partId));
  // A plate's DXF and a sheet metal part's flat DXF are both drawn in the app (plateDxf.ts).
  if (row && (format === "DXF" || format === "DXF_FLAT")) return flatDxf(row, member, search.get("fab") === "1", started + 50_000);
  if (!row) return new NextResponse("This part isn't from Onshape.", { status: 400 });
  // ?fab=1 (To Fab): the state the part was released at, when it was locked (plan/fab-version-lock.md).
  try {
    const target = partFileTarget(row, format, search.get("fab") === "1");
    const got = await ensurePartFile(target, member, started + 50_000);
    if (!got.cached) {
      return new NextResponse(got.body, {
        headers: { "content-type": target.type, "content-disposition": contentDisposition(target.filename) },
      });
    }
    return NextResponse.redirect(await presignDownload(target.key!, target.filename, false));
  } catch (err) {
    if (err instanceof PartFileError) return new NextResponse(err.message, { status: err.status });
    if (err instanceof OnshapeError) return new NextResponse(err.message, { status: 502 });
    throw err;
  }
}

async function flatDxf(
  row: { part: typeof schema.parts.$inferSelect; assemblyUrl: string | null; robotId: string },
  member: { id: string; onshapeConnected: boolean },
  fab: boolean,
  deadline: number,
) {
  const filename = plateDxfName(row.part);
  try {
    const text = await plateDxf(row, member, fab, deadline);
    const key = storageConfigured() ? plateDxfKey(row, fab) : null;
    if (key) return NextResponse.redirect(await presignDownload(key, filename, false));
    return new NextResponse(text, { headers: { "content-type": "image/vnd.dxf", "content-disposition": contentDisposition(filename) } });
  } catch (err) {
    if (err instanceof PlateDxfError) return new NextResponse(err.message, { status: err.status });
    if (err instanceof NeedsOnshapeError) return new NextResponse(err.message, { status: 403 });
    if (err instanceof OnshapeError) return new NextResponse(err.message, { status: 502 });
    throw err;
  }
}
