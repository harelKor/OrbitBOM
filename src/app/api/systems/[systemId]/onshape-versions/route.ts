import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { loadSystemReview } from "@/lib/data/cadReview";
import { DENIED, hasCapability } from "@/lib/mode";
import { onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { parseOnshapeUrl } from "@/lib/onshape/url";
import { isUuid } from "@/lib/uuid";
import { readDocVersions } from "@/lib/versions/docVersions";

// The CAD Review tree's Refresh: reads the design document's Onshape versions (1 call) and keeps
// them, so the tree shows versions nobody has updated the BOM to yet.
export async function POST(_: Request, { params }: { params: Promise<{ systemId: string }> }) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await hasCapability("sync"))) return NextResponse.json({ error: DENIED.sync }, { status: 403 });
  if (!member.onshapeConnected) return NextResponse.json({ error: "Connect your Onshape account first (Profile → Connect Onshape)." }, { status: 403 });
  const { systemId } = await params;
  if (!isUuid(systemId)) return NextResponse.json({ error: "Unknown system." }, { status: 404 });
  const [[system], review] = await Promise.all([db.select({ url: schema.systems.assemblyUrl }).from(schema.systems).where(eq(schema.systems.id, systemId)), loadSystemReview(systemId)]);
  const asm = system?.url ? parseOnshapeUrl(system.url) : null;
  if (!asm || !review?.treeDid) return NextResponse.json({ error: "Link the system to its Onshape assembly first." }, { status: 400 });
  try {
    const list = await readDocVersions(onshapeClient(member.id, asm.baseUrl), review.treeDid);
    return NextResponse.json({ versions: list.length });
  } catch (err) {
    if (err instanceof OnshapeError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
