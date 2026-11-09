import { NextResponse, type NextRequest } from "next/server";
import { getMember } from "@/lib/auth";
import { panelVersion } from "@/lib/reviews/panelVersion";
import { isUuid } from "@/lib/uuid";

// The Onshape panel's comment page asks which Onshape version its comments go on. A GET route,
// not a server action, so it never queues behind the page's other actions; it may read Onshape
// once, which a page render must never do.
export async function GET(request: NextRequest) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const q = request.nextUrl.searchParams;
  const systemId = q.get("systemId") ?? "";
  if (!isUuid(systemId)) return NextResponse.json({ error: "Unknown system." }, { status: 404 });
  const wv = q.get("wv");
  const result = await panelVersion(member, systemId, { did: q.get("did"), wv: wv === "v" || wv === "w" ? wv : null, wvId: q.get("wvId") });
  if (!result) return NextResponse.json({ error: "That system is gone." }, { status: 404 });
  return NextResponse.json(result);
}
