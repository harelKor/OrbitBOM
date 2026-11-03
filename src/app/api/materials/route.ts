import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { listMaterialGroups } from "@/lib/data/materials";

// Every material picker's list (the whole inventory by category). The app layout used to send
// it with every page render and every save; the browser now fetches it once and again in the
// background after a save, so a click doesn't wait on the whole shop (2026-11-03).
export async function GET() {
  if (!(await getMember())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const groups = await listMaterialGroups();
  return NextResponse.json(groups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, specs: {} })) })));
}
