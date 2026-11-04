import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { batchLayout } from "@/lib/fab/batchLayout";
import { isUuid } from "@/lib/uuid";

export const maxDuration = 60;

// A Fab batch's Auto Layout: its parts laid flat and nested on the smallest stock plate that takes
// them. Reads the 3D meshes already saved in R2; calls Onshape only for a sheet metal part's flat
// pattern the first time (1 call per part revision, src/lib/fab/batchLayout.ts).
export async function GET(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { groupId } = await params;
  if (!isUuid(groupId)) return NextResponse.json({ error: "Unknown batch." }, { status: 404 });
  const url = new URL(request.url);
  const num = (k: string, d: number) => {
    const n = Number(url.searchParams.get(k));
    return url.searchParams.has(k) && Number.isFinite(n) && n >= 0 && n <= 200 ? n : d;
  };
  try {
    const layout = await batchLayout(groupId, num("gap", 8), num("margin", 10), member);
    if (!layout) return NextResponse.json({ error: "Unknown batch." }, { status: 404 });
    return NextResponse.json(layout);
  } catch (err) {
    console.error("Auto Layout failed", err);
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Auto Layout failed: ${reason.slice(0, 300)}` }, { status: 500 });
  }
}
