import { NextResponse, type NextRequest } from "next/server";
import { REFRESH } from "@/config/refresh";
import { cronAllowed } from "@/lib/cron";
import { refreshDueSystems } from "@/lib/sync/refresh";

export const maxDuration = 60;

// Background refresh (plan §4), off while REFRESH.scheduled is false. Nothing calls it now (the
// cron-job.org schedule went with Vercel); turning it back on = a 10-minute systemd timer in
// deploy/setup.sh sending CRON_SECRET, like keep-alive. Each due system costs one Onshape call
// unless its document changed.
export async function GET(request: NextRequest) {
  if (!cronAllowed(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!REFRESH.scheduled) return NextResponse.json({ disabled: true });
  const started = Date.now();
  const results = await refreshDueSystems(started + 55_000);
  return NextResponse.json({
    checked: results.length,
    changed: results.filter((r) => r.changed).length,
    failed: results.filter((r) => r.error).map((r) => ({ system: r.systemId, error: r.error })),
    calls: results.reduce((n, r) => n + r.calls, 0),
    ms: Date.now() - started,
  });
}
