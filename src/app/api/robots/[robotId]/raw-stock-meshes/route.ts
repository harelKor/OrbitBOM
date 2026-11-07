import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { rawStockMeshes } from "@/lib/data/rawStock";
import { isUuid } from "@/lib/uuid";

// The Raw stock planner's plate parts' saved 3D shapes (short-lived links), so the browser can
// draw their real outlines.
export async function GET(_: Request, { params }: { params: Promise<{ robotId: string }> }) {
  if (!(await getMember())) return new NextResponse("Sign in first.", { status: 401 });
  const { robotId } = await params;
  if (!isUuid(robotId)) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json({ meshes: await rawStockMeshes(robotId) });
}
