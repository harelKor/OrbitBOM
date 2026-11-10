import { NextResponse } from "next/server";
import { sandboxRobot } from "@/lib/model/sandbox";

// The local 3D sandbox's robot (/dev/viewer): the model and its part names. Development only.
export function GET() {
  if (process.env.NODE_ENV === "production") return new NextResponse(null, { status: 404 });
  return NextResponse.json(sandboxRobot("/api/dev/viewer/studio"));
}
