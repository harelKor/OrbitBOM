import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getMember } from "@/lib/auth";
import { DENIED, hasCapability } from "@/lib/mode";
import { syncOnshapeDrawings } from "@/lib/drawing/onshapeSync";
import { OnshapeError } from "@/lib/onshape/client";
import { isUuid } from "@/lib/uuid";

// Fluid compute lets a Hobby function run up to 300 s; new exports stop at 240 s.
export const maxDuration = 300;

// `cached`: the part window's Find drawing, which may reuse a recent listing of the drawing tabs.
const Body = z.object({ partIds: z.array(z.uuid()).min(1).max(500).optional(), cached: z.boolean().optional() });

// One round of pulling the system's Onshape drawing tabs onto its parts (system page, Edit mode →
// Drawings → Sync Onshape drawings, or a drawing window's Sync again). Never called on its own.
export async function POST(request: Request, { params }: { params: Promise<{ systemId: string }> }) {
  const started = Date.now();
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await hasCapability("draw"))) return NextResponse.json({ error: DENIED.draw }, { status: 403 });
  const { systemId } = await params;
  if (!isUuid(systemId)) return NextResponse.json({ error: "Unknown system." }, { status: 404 });
  const body = Body.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "Those parts don't look right." }, { status: 400 });
  if (!member.onshapeConnected) {
    return NextResponse.json({ error: "Connect your Onshape account first (Profile → Connect Onshape)." }, { status: 403 });
  }
  try {
    const summary = await syncOnshapeDrawings(systemId, body.data.partIds ?? null, member.id, started + 240_000, body.data.cached ?? false);
    if (summary.linked.length) revalidatePath("/robots", "layout");
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof OnshapeError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("Onshape drawing sync failed", err);
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Onshape drawing sync failed: ${reason.slice(0, 300)}` }, { status: 500 });
  }
}
