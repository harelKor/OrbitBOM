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
// Each warm serverless instance keeps its own pool, and Supabase's free pooler has few server
// connections to share, so keep the pool small. Connections that stall (a frozen function leaves
// them mid-query) are dropped after a timeout instead of holding the pool for every page.
const client =
  globalForDb.pg ??
  postgres(connectionUrl(process.env.DATABASE_URL!), {
    prepare: false,
    max: 3,
    connect_timeout: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 10,
  });
if (process.env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema });
export { schema };
