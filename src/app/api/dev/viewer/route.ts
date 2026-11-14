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
  // ?fail=1: the first file fails once (then loads), for the "N failed · Retry" check.
  const fail = new URL(request.url).searchParams.get("fail") === "1";
  const studios = fail ? robot.model.studios.map((u, i) => (i === 0 && u ? `${u}${u.includes("?") ? "&" : "?"}fail=${Date.now()}` : u)) : robot.model.studios;
  const keys = fail && robot.model.keys ? robot.model.keys.map((k, i) => (i === 0 && k ? `${k}/fail-${Date.now()}` : k)) : robot.model.keys;
  return NextResponse.json({ ...robot, model: { ...robot.model, studios, keys, sketches } });
}
