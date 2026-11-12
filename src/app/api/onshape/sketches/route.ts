import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { DENIED, hasCapability } from "@/lib/mode";
import { logCalls, onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { listSketches } from "@/lib/onshape/sketches";
import { apiPath, parseOnshapeUrl } from "@/lib/onshape/url";

// The sketches of the Part Studio the Onshape panel is open on (1 call), for choosing a Basepart's
// Geometry (Harel, 2026-11-12). A GET route so the panel's page renders without calling Onshape.
// ?url= the Part Studio's link.
export async function GET(request: Request) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await hasCapability("sync"))) return NextResponse.json({ error: DENIED.sync }, { status: 403 });
  if (!member.onshapeConnected) return NextResponse.json({ error: "Connect Onshape on your OrbitParts profile page to list the sketches." }, { status: 403 });
  const ref = parseOnshapeUrl(new URL(request.url).searchParams.get("url") ?? "");
  if (!ref?.eid) return NextResponse.json({ error: "Open this from a Part Studio." }, { status: 400 });
  const client = onshapeClient(member.id, ref.baseUrl);
  try {
    return NextResponse.json({ sketches: await listSketches(client, apiPath(ref)) });
  } catch (err) {
    if (err instanceof OnshapeError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  } finally {
    logCalls("geometry-sketches", client);
  }
}
