import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { listMaterialGroups } from "@/lib/data/materials";

// Every material picker's list (the whole inventory by category). The app layout used to send
// it with every page render and every save; the browser now fetches it once and again in the
// background after a save, so a click doesn't wait on the whole shop (2026-11-03).
export async function GET() {
  if (!(await getMember())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const groups = await listMaterialGroups();
  // Specs stay on the server, but a Raw Stock item's size: the order pages name its stock size
  // and sort plates by thickness (Harel, 2026-11-24).
  return NextResponse.json(groups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i, specs: g.raw ? sizeSpecs(i.specs) : {} })) })));
}

const SIZE_SPECS = ["thickness", "size", "length"];
function sizeSpecs(specs: Record<string, string>) {
  return Object.fromEntries(Object.entries(specs).filter(([k, v]) => SIZE_SPECS.includes(k) && v));
}
