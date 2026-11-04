import "server-only";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db";

export type CotsCart = { id: string; vendor: string; createdAt: string; partIds: string[] };

// The Order List's carts, newest first, with their parts. The page decides which still show: a
// cart goes once none of its parts is left on the list.
export async function listCotsCarts(): Promise<CotsCart[]> {
  const [carts, members] = await Promise.all([
    db.select().from(schema.cotsCarts).orderBy(desc(schema.cotsCarts.createdAt)),
    db.select().from(schema.cotsCartMembers),
  ]);
  const partsOf = new Map<string, string[]>();
  for (const m of members) partsOf.set(m.cartId, [...(partsOf.get(m.cartId) ?? []), m.partId]);
  return carts.map((c) => ({ id: c.id, vendor: c.vendor, createdAt: c.createdAt.toISOString(), partIds: partsOf.get(c.id) ?? [] }));
}
