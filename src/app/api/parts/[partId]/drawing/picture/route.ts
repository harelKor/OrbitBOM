import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { pictureKey } from "@/lib/drawing/extra";
import { DENIED, hasCapability } from "@/lib/mode";
import { imageUrl, putObject, storageConfigured } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";

const MAX_BYTES = 4 * 1024 * 1024;

// An added angled view's picture (extra.ts), drawn in the member's browser (picture.ts): kept
// in R2 under the part and the view's key, replaced when it's drawn again. Answers its link.
export async function PUT(request: Request, { params }: { params: Promise<{ partId: string }> }) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!(await hasCapability("draw"))) return NextResponse.json({ error: DENIED.draw }, { status: 403 });
  const { partId } = await params;
  if (!isUuid(partId)) return NextResponse.json({ error: "Unknown part." }, { status: 404 });
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!/^add[a-z0-9]{1,16}$/.test(key)) return NextResponse.json({ error: "Unknown view." }, { status: 400 });
  if (!storageConfigured()) return NextResponse.json({ error: "File storage isn't set up." }, { status: 503 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!png || bytes.length > MAX_BYTES) return NextResponse.json({ error: "That picture doesn't look right." }, { status: 400 });
  await putObject(pictureKey(partId, key), bytes, "image/png");
  return NextResponse.json({ href: await imageUrl(pictureKey(partId, key)) });
}
