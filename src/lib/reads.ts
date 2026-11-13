import type { READS } from "@/lib/readList";
import { fromWire } from "@/lib/wire";

type Reads = typeof READS;

// Calls one of the window reads (GET /api/reads/<name>, src/lib/readList.ts) as a GET request, so it runs
// beside saves instead of queuing with them. Same arguments and result as the server action; it
// throws when the read fails, as the action did.
export async function read<K extends keyof Reads>(name: K, ...args: Parameters<Reads[K]>): Promise<Awaited<ReturnType<Reads[K]>>> {
  const res = await fetch(`/api/reads/${name}?args=${encodeURIComponent(JSON.stringify(args))}`, { cache: "no-store" });
  if (!res.ok || !res.headers.get("content-type")?.includes("application/json")) throw new Error(`Couldn't load (${res.status}).`);
  return fromWire<Awaited<ReturnType<Reads[K]>>>(await res.text());
}
