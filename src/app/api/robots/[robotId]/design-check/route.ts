import { NextResponse, type NextRequest } from "next/server";
import { getMember } from "@/lib/auth";
import { loadCheckData } from "@/lib/check/store";
import { isUuid } from "@/lib/uuid";

// The CAD page's Design check (plan/design-check.md): limits, what's known about each part's
// weight, the overlaps marked fine and the newest saved run. A GET, so it never waits behind a
// server action; database only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ robotId: string }> }) {
  if (!(await getMember())) return new NextResponse("Sign in first.", { status: 401 });
  const { robotId } = await params;
  if (!isUuid(robotId)) return new NextResponse("Not found", { status: 404 });
  const model = request.nextUrl.searchParams.get("model") === "basepart" ? "basepart" : "final";
  const data = await loadCheckData(robotId, model);
  if (!data) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
