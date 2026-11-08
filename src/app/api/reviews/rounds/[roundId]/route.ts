import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { DENIED, hasCapability } from "@/lib/mode";
import { OnshapeError } from "@/lib/onshape/client";
import { buildRoundStep, roundModel } from "@/lib/reviews/rounds";
import { StorageNotConfiguredError } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";

// A CAD Review round's 3D model for the viewer: placements, part names and short-lived mesh
// links. Reads the database only; mentors viewing a round never call Onshape.
export async function GET(_: Request, { params }: { params: Promise<{ roundId: string }> }) {
  if (!(await getMember())) return new NextResponse("Sign in first.", { status: 401 });
  const { roundId } = await params;
  if (!isUuid(roundId)) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json({ model: await roundModel(roundId) });
}

// One build step of a round on the member's Onshape account; the page calls again while the
// answer says "working".
export async function POST(_: Request, { params }: { params: Promise<{ roundId: string }> }) {
  const started = Date.now();
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await hasCapability("sync"))) return NextResponse.json({ error: DENIED.sync }, { status: 403 });
  const { roundId } = await params;
  if (!isUuid(roundId)) return NextResponse.json({ error: "Unknown round." }, { status: 404 });
  if (!member.onshapeConnected) {
    return NextResponse.json({ error: "Connect your Onshape account first (Profile → Connect Onshape)." }, { status: 403 });
  }
  try {
    // Short steps: the shared server stays responsive and the page shows progress.
    return NextResponse.json(await buildRoundStep(roundId, member.id, started + 60_000));
  } catch (err) {
    if (err instanceof OnshapeError || err instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Review round build failed", err);
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `The 3D export failed: ${reason.slice(0, 300)}` }, { status: 500 });
  }
}
