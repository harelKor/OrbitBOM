import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Supabase's transaction pooler (port 6543) does not support prepared statements. Supabase's
// "Connect" panel adds ?pgbouncer=true (a Prisma flag); postgres-js would send it to the server
// as a setting, so it is dropped here.
function connectionUrl(raw: string) {
  try {
    const url = new URL(raw);
    url.searchParams.delete("pgbouncer");
    return url.toString();
  } catch {
    return raw;
  }
}

const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };
const client =
  globalForDb.pg ?? postgres(connectionUrl(process.env.DATABASE_URL!), { prepare: false, max: 5 });
if (process.env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema });
export { schema };
