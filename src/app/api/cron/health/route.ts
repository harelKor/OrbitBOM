import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { healthCheck } from "@/lib/health/check";
import { saveNightlyBackup } from "@/lib/storage/backup";

export const maxDuration = 60;

// Read-only health check of the live database and R2 (lib/health/check.ts): broken references,
// indexes, migrations, sizes, backups. ?run=backup first saves today's backup (the same file the
// nightly keep-alive writes), to check it works without waiting for the night. Callers send CRON_SECRET, or the audit key whose hash is below.
const KEY_SHA256 = "60658563f3586b8bdbf4a1fcd5491e19d246f311f11092c5e26c6edee74e8556";

function allowed(request: NextRequest) {
  if (process.env.CRON_SECRET && request.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`) return true;
  const key = request.nextUrl.searchParams.get("key");
  if (!key) return false;
  return timingSafeEqual(createHash("sha256").update(key).digest(), Buffer.from(KEY_SHA256, "hex"));
}

export async function GET(request: NextRequest) {
  if (!allowed(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const backup = request.nextUrl.searchParams.get("run") === "backup" ? await saveNightlyBackup() : undefined;
  return NextResponse.json({ ...(backup && { backup }), ...(await healthCheck()) });
}
