import { NextResponse, type NextRequest } from "next/server";
import { REFRESH } from "@/config/refresh";
import { refreshDueSystems } from "@/lib/sync/refresh";

export const maxDuration = 60;

// Background refresh (plan §4). Only the daily keep-alive runs on a timer, so an outside
// scheduler (cron-job.org, docs/setup.md §3) calls this every 10 minutes with CRON_SECRET.
// Each due system costs one Onshape call unless its document changed.
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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
