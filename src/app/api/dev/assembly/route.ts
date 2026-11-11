import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { encodeMeshes } from "@/lib/model/mesh";
import { sandboxRobot, sandboxStudio } from "@/lib/model/sandbox";

// The /dev/assembly sandbox's robot: /dev/viewer's, with its systems given the UUIDs the made-up
// Assembly data uses (the page reads systems by UUID, the 3D groups by system id). Development only.
const sandboxSystemId = (g: number) => `00000000-0000-4000-8000-00000000000${g + 1}`;

export function GET() {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  const key = `dev/sandbox/${createHash("sha1").update(encodeMeshes(sandboxStudio())).digest("hex").slice(0, 16)}.bin.gz`;
  const robot = sandboxRobot("/api/dev/viewer/studio", { key });
  return NextResponse.json({ ...robot, model: { ...robot.model, groups: robot.model.groups.map((g, i) => ({ ...g, systemIds: [sandboxSystemId(i)] })) } });
}
