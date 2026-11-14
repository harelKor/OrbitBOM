import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getMember } from "@/lib/auth";
import { DENIED, hasCapability } from "@/lib/mode";
import { OnshapeError } from "@/lib/onshape/client";
import { refreshPartData } from "@/lib/onshape/thumbnails";
import { isUuid } from "@/lib/uuid";

// After parts change from Onshape: each Part Studio's sheet metal and body types for the export
// files (refreshPartData; a Part Studio read before at the same revision costs nothing). The
// pictures are drawn in the browser from the 3D model (src/components/viewer/pictures.ts).
export async function POST(_: Request, { params }: { params: Promise<{ systemId: string }> }) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  // It spends the member's and the team's Onshape calls, like Update BOM.
  if (!(await hasCapability("sync"))) return NextResponse.json({ error: DENIED.sync }, { status: 403 });
  const { systemId } = await params;
  if (!isUuid(systemId)) return NextResponse.json({ error: "Unknown system." }, { status: 404 });
  if (!member.onshapeConnected) {
    return NextResponse.json({ error: "Connect your Onshape account first (Profile → Connect Onshape)." }, { status: 403 });
  }
  try {
    const summary = await refreshPartData(systemId, member.id);
    if (summary.studios) revalidatePath("/robots", "layout");
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof OnshapeError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("Part data failed", err);
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Reading the parts from Onshape failed: ${reason.slice(0, 300)}` }, { status: 500 });
  }
}
