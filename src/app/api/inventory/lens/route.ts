import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { lensSearch } from "@/lib/recognize/lens";
import { readScanPhoto } from "@/lib/recognize/photo";

// Scan's web results: the captured photo searched across the whole web (Google Lens through
// Serper), shown like search results beside the AI's specs (Harel, 2026-11-13).
export async function POST(req: Request) {
  if (!(await getMember())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { image?: unknown } | null;
  const image = readScanPhoto(body?.image);
  if (!image) return NextResponse.json({ error: "Send one JPEG photo under 1.5 MB." }, { status: 400 });
  const started = Date.now();
  const { offers, error } = await lensSearch(Buffer.from(image, "base64"));
  return NextResponse.json({ offers, error, ms: Date.now() - started });
}
