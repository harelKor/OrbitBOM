import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { loadBody } from "@/lib/drawing/bodyStore";
import { isUuid } from "@/lib/uuid";

// The part's geometry kept with its drawing (bodyPack.ts), for views added in the drawing editor.
// R2 only, no Onshape call. 404 for drawings made before it was kept: Regenerate once.
export async function GET(_: Request, { params }: { params: Promise<{ partId: string }> }) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { partId } = await params;
  if (!isUuid(partId)) return NextResponse.json({ error: "Unknown part." }, { status: 404 });
  const body = await loadBody(partId);
  if (!body) return NextResponse.json({ error: "Regenerate the drawing once to add views." }, { status: 404 });
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
}
