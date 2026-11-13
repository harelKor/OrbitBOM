import { READS } from "@/lib/readList";
import { toWire } from "@/lib/wire";

// Reads that windows make while they open. The browser runs server actions one at a time, so as
// actions they held up a save clicked meanwhile (and waited behind one); as GET requests they run
// side by side. Each still runs its own action, with its sign-in and capability checks
// (src/lib/readList.ts; the browser calls them through src/lib/reads.ts).

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const read = READS[name as keyof typeof READS] as ((...args: unknown[]) => Promise<unknown>) | undefined;
  if (!read || !Object.hasOwn(READS, name)) return new Response("Unknown read.", { status: 404 });
  let args: unknown[];
  try {
    args = JSON.parse(new URL(req.url).searchParams.get("args") ?? "[]");
    if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) throw new Error();
  } catch {
    return new Response("Bad arguments.", { status: 400 });
  }
  const result = await read(...args);
  return new Response(toWire(result), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
