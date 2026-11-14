import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getMember } from "@/lib/auth";
import { listPlaces } from "@/lib/data/places";
import { isUuid } from "@/lib/uuid";

// The shop map's places for windows that open it outside Inventory (a BOM part's system drawer),
// fetched when needed so BOM pages don't carry them. ?system=<id> adds that system's drawers by
// status (Harel, 2026-11-14).
export async function GET(request: Request) {
  if (!(await getMember())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const systemId = new URL(request.url).searchParams.get("system");
  const [places, system] = await Promise.all([
    listPlaces(),
    systemId && isUuid(systemId) ? db.select({ drawers: schema.systems.drawers }).from(schema.systems).where(eq(schema.systems.id, systemId)) : Promise.resolve([]),
  ]);
  return NextResponse.json({ places, drawers: system[0]?.drawers ?? {} });
}
