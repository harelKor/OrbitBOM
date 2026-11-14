import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { cronAllowed } from "@/lib/cron";
import { healthCheck } from "@/lib/health/check";
import { statusChecks } from "@/lib/health/status";
import { saveNightlyBackup } from "@/lib/storage/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Two answers (safety net, 2026-11-14):
// - Anyone (the UptimeRobot monitor, docs/runbook.md → Alerts): 200 when everything's fine, 503
//   when the database is down or above 80% of 500 MB, migrations are out of step with the live
//   code, or the newest nightly backup is older than 26 h. Only the names of the failing checks,
//   and kept for a minute so a busy monitor costs nothing.
// - With CRON_SECRET (Authorization: Bearer …) or the audit key whose hash is below
//   (X-Health-Key header; it used to be ?key=, which ends up in logs): the whole read-only report
//   from lib/health/check.ts. ?run=backup first saves today's JSON backup.
const KEY_SHA256 = "60658563f3586b8bdbf4a1fcd5491e19d246f311f11092c5e26c6edee74e8556";

function fullReport(request: NextRequest) {
  if (cronAllowed(request)) return true;
  const key = request.headers.get("x-health-key");
  return !!key && timingSafeEqual(createHash("sha256").update(key).digest(), Buffer.from(KEY_SHA256, "hex"));
}

let recent: { at: number; status: Awaited<ReturnType<typeof statusChecks>> } | null = null;

export async function GET(request: NextRequest) {
  const full = fullReport(request);
  if (!recent || Date.now() - recent.at > 60_000 || full) recent = { at: Date.now(), status: await statusChecks() };
  const { status } = recent;
  const code = status.ok ? 200 : 503;
  const headers = { "cache-control": "no-store" };
  if (!full) {
    const failing = Object.entries(status.checks).filter(([, c]) => !c.ok).map(([name]) => name);
    return NextResponse.json({ ok: status.ok, failing }, { status: code, headers });
  }
  const backup = request.nextUrl.searchParams.get("run") === "backup" ? await saveNightlyBackup() : undefined;
  return NextResponse.json({ ...status, ...(backup && { backup }), report: await healthCheck() }, { status: code, headers });
}
