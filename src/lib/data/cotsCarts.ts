import "server-only";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db";

// `vendor` "" and a `name`: a cart of parts with no product link, named by the member (Harel, 2026-11-24).
export type CotsCart = { id: string; vendor: string; name: string | null; createdAt: string; partIds: string[] };

// The Order List's carts, newest first, with their parts. The page decides which still show: a
// cart goes once none of its parts is left on the list.
export async function listCotsCarts(): Promise<CotsCart[]> {
  const [carts, members] = await Promise.all([
    db.select().from(schema.cotsCarts).orderBy(desc(schema.cotsCarts.createdAt)),
    db.select().from(schema.cotsCartMembers),
  ]);
  const partsOf = new Map<string, string[]>();
  for (const m of members) partsOf.set(m.cartId, [...(partsOf.get(m.cartId) ?? []), m.partId]);
  return carts.map((c) => ({ id: c.id, vendor: c.vendor, name: c.name, createdAt: c.createdAt.toISOString(), partIds: partsOf.get(c.id) ?? [] }));
}
