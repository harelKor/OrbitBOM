import { NextResponse } from "next/server";
import { z } from "zod";
import { getMember } from "@/lib/auth";
import { NeedsOnshapeError } from "@/lib/model/part";
import { OnshapeError } from "@/lib/onshape/client";
import { StorageNotConfiguredError } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";
import { previewModel } from "@/lib/versions/preview";

export const maxDuration = 60;

const body = z.object({
  side: z.enum(["before", "after"]),
  draftId: z.uuid().optional(),
  key: z.string().max(500).optional(),
  rowId: z.uuid().optional(),
  partId: z.uuid().optional(),
});

// One side of a change's Before → After preview in the Commit window. May export the part from
// Onshape (1 call) the first time, so it's a POST from expanding a box, never part of rendering.
export async function POST(req: Request, { params }: { params: Promise<{ systemId: string }> }) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { systemId } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!isUuid(systemId) || !parsed.success) return NextResponse.json({ error: "Unknown part." }, { status: 404 });
  try {
    const model = await previewModel(systemId, member, parsed.data);
    if (!model) return NextResponse.json({ error: "No 3D preview for this side." }, { status: 404 });
    return NextResponse.json({ model });
  } catch (err) {
    if (err instanceof OnshapeError || err instanceof StorageNotConfiguredError || err instanceof NeedsOnshapeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Version preview failed", err);
    return NextResponse.json({ error: "The 3D preview failed." }, { status: 500 });
  }
}
