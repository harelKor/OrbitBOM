import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { buildRobotModel, robotModel } from "@/lib/model/build";
import { OnshapeError } from "@/lib/onshape/client";
import { StorageNotConfiguredError } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";

// Fluid compute lets a Hobby function run up to 300 s; new Part Studio exports stop starting
// after 150 s so the slowest one still finishes inside the limit.
export const maxDuration = 300;

// The robot's 3D model for the dashboard viewer: placements plus short-lived mesh links.
// Reads the database only; Onshape is called by POST.
export async function GET(_: Request, { params }: { params: Promise<{ robotId: string }> }) {
  if (!(await getMember())) return new NextResponse("Sign in first.", { status: 401 });
  const { robotId } = await params;
  if (!isUuid(robotId)) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json({ model: await robotModel(robotId) });
}

// One build step of the model on the member's Onshape account; the viewer calls again while
// the answer says "working".
export async function POST(_: Request, { params }: { params: Promise<{ robotId: string }> }) {
  const started = Date.now();
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { robotId } = await params;
  if (!isUuid(robotId)) return NextResponse.json({ error: "Unknown robot." }, { status: 404 });
  if (!member.onshapeConnected) {
    return NextResponse.json({ error: "Connect your Onshape account first (Profile → Connect Onshape)." }, { status: 403 });
  }
  try {
    return NextResponse.json(await buildRobotModel(robotId, member.id, started + 150_000));
  } catch (err) {
    if (err instanceof OnshapeError || err instanceof StorageNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    // Anything else (storage, database, an unexpected Onshape answer): show the reason so it
    // can be fixed, and keep the details in the function log.
    console.error("3D model build failed", err);
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `The 3D export failed: ${reason.slice(0, 300)}` }, { status: 500 });
  }
}
