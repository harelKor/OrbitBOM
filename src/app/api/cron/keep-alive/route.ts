import { sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";

// Daily Vercel Cron (vercel.json). Supabase pauses a free project after 7 days without
// activity; one query a day keeps it awake.
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [row] = await db.execute<{ members: number }>(
    sql`select count(*)::int as members from members`,
  );
  return NextResponse.json({ ok: true, members: row?.members ?? 0, at: new Date().toISOString() });
}
