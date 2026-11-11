import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { listNamedViews } from "@/lib/reviews/namedViews";
import { isUuid } from "@/lib/uuid";

// The robot's Named views for the view cube's menu (S6): a GET, so reading them never waits
// behind a server action.
export async function GET(_request: Request, { params }: { params: Promise<{ robotId: string }> }) {
  if (!(await getMember())) return new NextResponse("Sign in first.", { status: 401 });
  const { robotId } = await params;
  if (!isUuid(robotId)) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json({ views: await listNamedViews(robotId) }, { headers: { "Cache-Control": "private, no-store" } });
}
