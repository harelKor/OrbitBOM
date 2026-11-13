import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { imageUrl, objectExists, storageConfigured } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// One part from a model's Part Studio file, for Update CAD / Update Basepart's Commit window
// (Harel, 2026-11-13): Before is the file the 3D model has, After the one the check exported. A
// stored file only: no Onshape calls.
export async function GET(request: Request, { params }: { params: Promise<{ robotId: string }> }) {
  if (!(await getMember())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { robotId } = await params;
  const url = new URL(request.url);
  const file = url.searchParams.get("file") ?? "";
  const k = url.searchParams.get("k") ?? "";
  if (!isUuid(robotId) || !/^models\/studios\/[0-9a-f]{24}\/[0-9a-f]{24}\/[0-9a-f]{20}\.bin\.gz$/.test(file) || !/^[0-9a-f]{24}:[0-9a-f]{24}:[^/]+$/.test(k)) {
    return NextResponse.json({ error: "Unknown part." }, { status: 400 });
  }
  if (!storageConfigured() || !(await objectExists(file))) return NextResponse.json({ error: "This part's 3D file isn't stored." }, { status: 404 });
  return NextResponse.json({ model: { studios: [await imageUrl(file)], keys: [file], placements: [{ s: 0, k, t: IDENTITY }] } });
}
