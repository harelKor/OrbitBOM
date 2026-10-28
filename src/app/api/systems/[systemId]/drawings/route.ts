import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getMember } from "@/lib/auth";
import { DENIED, hasCapability } from "@/lib/mode";
import { makeDrawings } from "@/lib/drawing/make";
import { OnshapeError } from "@/lib/onshape/client";
import { isUuid } from "@/lib/uuid";

// Fluid compute lets a Hobby function run up to 300 s; new Part Studios stop at 240 s.
export const maxDuration = 300;

const Body = z.object({ partIds: z.array(z.uuid()).min(1).max(500) });

// One round of making drawings for the chosen parts (system page, Edit mode → Drawings). The
// button calls again with what's left.
export async function POST(request: Request, { params }: { params: Promise<{ systemId: string }> }) {
  const started = Date.now();
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await hasCapability("draw"))) return NextResponse.json({ error: DENIED.draw }, { status: 403 });
  const { systemId } = await params;
  if (!isUuid(systemId)) return NextResponse.json({ error: "Unknown system." }, { status: 404 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Pick some parts first." }, { status: 400 });
  if (!member.onshapeConnected) {
    return NextResponse.json({ error: "Connect your Onshape account first (Profile → Connect Onshape)." }, { status: 403 });
  }
  try {
    const summary = await makeDrawings(systemId, body.data.partIds, member.id, started + 240_000);
    if (summary.made.length) revalidatePath("/robots", "layout");
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof OnshapeError) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("Drawings failed", err);
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Drawings failed: ${reason.slice(0, 300)}` }, { status: 500 });
  }
}
