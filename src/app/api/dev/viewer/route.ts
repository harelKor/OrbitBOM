import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { encodeMeshes } from "@/lib/model/mesh";
import { sandboxRobot, sandboxStudio } from "@/lib/model/sandbox";

// The local 3D sandbox's robot (/dev/viewer): the model and its part names. Development only.
// ?big=1: ~5000 instances over several files, for the loading check. The file's key is a hash of
// its content, like a real R2 key naming one revision, so the browser keeps it until the sandbox's
// shapes change.
export function GET(request: Request) {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  const big = new URL(request.url).searchParams.get("big") === "1";
  const key = `dev/sandbox/${createHash("sha1").update(encodeMeshes(sandboxStudio())).digest("hex").slice(0, 16)}.bin.gz`;
  const robot = sandboxRobot("/api/dev/viewer/studio", { key, big });
  // ?sketches=1: the sandbox's Geometry sketches too (sketch/route.ts), on the robot (no group).
  const sketches = new URL(request.url).searchParams.get("sketches") === "1" ? [{ url: "/api/dev/viewer/sketch", key: "dev/sandbox/sketch.json.gz", t: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], owner: "sandbox" }] : [];
  return NextResponse.json({ ...robot, model: { ...robot.model, sketches } });
}
