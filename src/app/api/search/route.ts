import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { globalSearch } from "@/lib/data/search";

// The top bar's search dropdown. A GET route, not a server action: the browser runs server actions
// one at a time, so a search per keystroke would hold up saving (CLAUDE.md). The box aborts it as
// soon as the typing changes.
export async function GET(req: Request) {
  if (!(await getMember())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 100) ?? "";
  if (q.length < 2) return NextResponse.json({ bom: [], inventory: [] });
  return NextResponse.json(await globalSearch(q));
}
