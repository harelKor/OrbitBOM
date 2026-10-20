import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { NeedsOnshapeError, partModel } from "@/lib/model/part";
import { OnshapeError } from "@/lib/onshape/client";
import { StorageNotConfiguredError } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";

export const maxDuration = 60;

// One part's 3D preview, opened from its card. May export the part from Onshape (1 call) the
// first time, so it's a POST from a click, never part of rendering a page.
export async function POST(_: Request, { params }: { params: Promise<{ partId: string }> }) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { partId } = await params;
  if (!isUuid(partId)) return NextResponse.json({ error: "Unknown part." }, { status: 404 });
  try {
    const model = await partModel(partId, member);
    if (!model) return NextResponse.json({ error: "This part isn't from Onshape." }, { status: 400 });
    return NextResponse.json({ model });
  } catch (err) {
    if (err instanceof OnshapeError || err instanceof StorageNotConfiguredError || err instanceof NeedsOnshapeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Part preview failed", err);
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `The 3D preview failed: ${reason.slice(0, 300)}` }, { status: 500 });
  }
}
