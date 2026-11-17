import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { flatCached, flatModel, NeedsOnshapeError } from "@/lib/model/part";
import { OnshapeError } from "@/lib/onshape/client";
import { StorageNotConfiguredError } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";

export const maxDuration = 60;

// A sheet metal part's flat pattern in the part window (Open flatten, Harel 2026-11-17). Any
// member, like the part's 3D preview and its CAD downloads.
// GET: whether it's kept already (no Onshape calls), for the button's cost hint.
export async function GET(_: Request, { params }: { params: Promise<{ partId: string }> }) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { partId } = await params;
  if (!isUuid(partId)) return NextResponse.json({ error: "Unknown part." }, { status: 404 });
  return NextResponse.json({ cached: await flatCached(partId) });
}

// POST: the flat pattern as a viewer model. The first time it reads the flat body's shape from
// Onshape (1–2 calls), then it's kept in R2 per Part Studio revision, so it's a POST from a click.
export async function POST(_: Request, { params }: { params: Promise<{ partId: string }> }) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { partId } = await params;
  if (!isUuid(partId)) return NextResponse.json({ error: "Unknown part." }, { status: 404 });
  try {
    const model = await flatModel(partId, member);
    if (!model) return NextResponse.json({ error: "This part isn't Onshape sheet metal, so it has no flat pattern." }, { status: 400 });
    return NextResponse.json({ model });
  } catch (err) {
    if (err instanceof OnshapeError || err instanceof StorageNotConfiguredError || err instanceof NeedsOnshapeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Flat pattern failed", err);
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `The flat pattern failed: ${reason.slice(0, 300)}` }, { status: 500 });
  }
}
