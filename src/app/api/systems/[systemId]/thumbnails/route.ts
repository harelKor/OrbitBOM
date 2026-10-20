import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getMember } from "@/lib/auth";
import { OnshapeError } from "@/lib/onshape/client";
import { refreshThumbnails } from "@/lib/onshape/thumbnails";
import { isUuid } from "@/lib/uuid";

// Fluid compute lets a Hobby function run up to 300 s; new downloads stop at 240 s.
export const maxDuration = 300;

// One round of a system's new or changed part thumbnails, after Update BOM. The button calls
// again while some are left.
export async function POST(_: Request, { params }: { params: Promise<{ systemId: string }> }) {
  const started = Date.now();
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { systemId } = await params;
  if (!isUuid(systemId)) return NextResponse.json({ error: "Unknown system." }, { status: 404 });
  if (!member.onshapeConnected) {
    return NextResponse.json({ error: "Connect your Onshape account first (Profile → Connect Onshape)." }, { status: 403 });
  }
  try {
    const summary = await refreshThumbnails(systemId, member.id, started + 240_000);
    if (summary.fetched) revalidatePath("/robots", "layout");
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof OnshapeError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("Thumbnails failed", err);
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Thumbnails failed: ${reason.slice(0, 300)}` }, { status: 500 });
  }
}
