import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { searchProducts } from "@/lib/inventory/search";

// The add box's store search. A GET route, not a server action: the browser runs server actions
// one at a time, so a slow store search used to hold up saving the item (Harel, 2026-10-29).
// The box aborts it as soon as the typing changes or an item is added.
export async function GET(req: Request) {
  if (!(await getMember())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  if (q.length < 3) return NextResponse.json({ groups: [], elsewhere: [], english: null, web: null });
  // web=1: the box's "Search the web" (Serper credits, capped a day); never on its own.
  return NextResponse.json(await searchProducts(q, { web: params.get("web") === "1" }));
}
