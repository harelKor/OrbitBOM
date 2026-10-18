import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { presignDownload, storageConfigured } from "@/lib/storage/r2";
import { isUuid } from "@/lib/uuid";

// Opens a part or group file: checks membership, then redirects to a short-lived R2 link.
// ?download=1 saves it instead of opening it in the browser.
export async function GET(request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const member = await getMember();
  if (!member) return new NextResponse("Sign in first.", { status: 401 });
  const { fileId } = await params;
  if (!isUuid(fileId) || !storageConfigured()) return new NextResponse("Not found", { status: 404 });
  const file =
    (await db.select().from(schema.partFiles).where(eq(schema.partFiles.id, fileId)))[0] ??
    (await db.select().from(schema.groupFiles).where(eq(schema.groupFiles.id, fileId)))[0];
  if (!file) return new NextResponse("Not found", { status: 404 });
  const download = new URL(request.url).searchParams.has("download");
  return NextResponse.redirect(await presignDownload(file.r2Key, file.filename, !download));
}
