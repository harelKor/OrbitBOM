import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { exportAssemblyStep } from "@/lib/onshape/export";
import { objectExists, presignDownload, putObject, storageConfigured } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";

export const maxDuration = 60;

// Download Batch .STEP: the batch's Onshape layout assembly as one STEP file. Cached in R2 per
// pushed layout, so downloading it again costs no Onshape calls.
export async function GET(_request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const started = Date.now();
  const member = await getMember();
  if (!member) return new NextResponse("Sign in first.", { status: 401 });
  const { groupId } = await params;
  if (!isUuid(groupId)) return new NextResponse("Unknown batch.", { status: 400 });
  const [group] = await db.select().from(schema.partGroups).where(eq(schema.partGroups.id, groupId));
  const ref = group?.onshapeLayout;
  if (!group || !ref) return new NextResponse("Make the Onshape Layout first.", { status: 400 });

  const filename = `Batch - ${group.name}.step`.replace(/[^\w.\- ]+/g, "_");
  const key = `exports/groups/${groupId}/${ref.rev}.step`;
  const cached = storageConfigured() && (await objectExists(key));
  if (!cached) {
    if (!member.onshapeConnected) return new NextResponse("Connect your Onshape account first (Profile → Connect Onshape).", { status: 403 });
    try {
      const body = await exportAssemblyStep(onshapeClient(member.id, ref.baseUrl), `d/${ref.did}/w/${ref.wid}/e/${ref.eid}`, started + 50_000);
      if (!storageConfigured()) {
        return new NextResponse(body, { headers: { "content-type": "model/step", "content-disposition": `attachment; filename="${filename}"` } });
      }
      await putObject(key, body, "model/step");
    } catch (err) {
      if (err instanceof OnshapeError) return new NextResponse(err.message, { status: 502 });
      throw err;
    }
  }
  return NextResponse.redirect(await presignDownload(key, filename, false));
}
