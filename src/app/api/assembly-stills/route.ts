import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { can } from "@/components/shell/mode";
import { getMember } from "@/lib/auth";
import { getMode } from "@/lib/mode";
import { putObject, StorageNotConfiguredError } from "@/lib/storage/r2";

// A still of an assembly step's 3D (a JPEG taken in the browser when CAD saves the step), stored
// before the step is saved; the step then points at it. The slides not on screen show it.
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const member = await getMember();
  if (!member) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!can(await getMode(), "instruct")) return NextResponse.json({ error: "Only the CAD Team can write assembly steps." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob) || file.type !== "image/jpeg") return NextResponse.json({ error: "Send the still as a JPEG." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "The still is too big." }, { status: 413 });
  const path = `assembly-stills/${randomUUID()}.jpg`;
  try {
    await putObject(path, await file.arrayBuffer(), file.type);
  } catch (err) {
    if (err instanceof StorageNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
  return NextResponse.json({ path });
}
