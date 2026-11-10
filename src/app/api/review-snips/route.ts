import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { putObject, StorageNotConfiguredError } from "@/lib/storage/r2";

// A snip's picture (a JPEG cut from the 3D view in the browser), stored before its comment is
// saved; the comment then points at it (Harel, 2026-11-10).
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || !["image/jpeg", "image/png"].includes(file.type)) return NextResponse.json({ error: "Send the snip as a JPEG or PNG." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "The snip is too big." }, { status: 413 });
  const path = `review-snips/${randomUUID()}.${file.type === "image/png" ? "png" : "jpg"}`;
  try {
    await putObject(path, await file.arrayBuffer(), file.type);
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
  return NextResponse.json({ path });
}
