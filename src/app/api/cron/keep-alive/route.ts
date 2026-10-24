import { sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { cleanUpStorage, recountStorage } from "@/lib/storage/usage";

export const maxDuration = 300;

// Daily Vercel Cron (vercel.json). Supabase pauses a free project after 7 days without
// activity; one query a day keeps it awake. It also recounts R2 storage and, above the clean-up
// line, frees space (src/config/storage.ts).
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const {
    rows: [row],
  } = await db.execute<{ members: number }>(sql`select count(*)::int as members from members`);
  const storage = await recountStorage()
    .then(async (count) => ({ ...count, cleanUp: await cleanUpStorage() }))
    .catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
  return NextResponse.json({ ok: true, members: row?.members ?? 0, storage, at: new Date().toISOString() });
}
