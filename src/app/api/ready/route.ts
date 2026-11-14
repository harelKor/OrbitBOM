import { NextResponse } from "next/server";
import { readiness } from "@/lib/health/status";

export const dynamic = "force-dynamic";

// deploy/release.sh keeps a new release only once this answers 200: the database answers and every
// migration the code needs is applied. Public (src/lib/supabase/proxy.ts), so it says no more than
// that; a database error goes to the server log only.
export async function GET() {
  const r = await readiness();
  if ("error" in r) console.error("ready: database", r.error);
  return NextResponse.json(
    { ready: r.ready, database: r.database, missingMigrations: "missingMigrations" in r ? r.missingMigrations : null },
    { status: r.ready ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
