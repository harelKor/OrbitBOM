import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Supabase's transaction pooler (port 6543) does not support prepared statements. Supabase's
// "Connect" panel adds ?pgbouncer=true (a Prisma flag), which is dropped here. An sslmode in the
// URL is turned into TLS without checking the certificate chain, as postgres-js did; pg would
// otherwise verify it against the system roots, which don't include Supabase's CA.
function connectionConfig(raw: string): { connectionString: string; ssl?: { rejectUnauthorized: false } } {
  try {
    const url = new URL(raw);
    url.searchParams.delete("pgbouncer");
    const mode = url.searchParams.get("sslmode");
    url.searchParams.delete("sslmode");
    return { connectionString: url.toString(), ...(mode && mode !== "disable" ? { ssl: { rejectUnauthorized: false } } : {}) };
  } catch {
    return { connectionString: raw };
  }
}

// node-postgres, not postgres-js: postgres-js sends the next query before the previous one has
// answered (pipelining), and through Supabase's transaction pooler that mixed up results in
// production ("toISOString is not a function", ".map of undefined" while mapping rows) and left
// queries that never finished. pg runs one query at a time per connection. Each warm serverless
// instance keeps its own pool and drops connections that stall. A page and the layout run about
// 20 queries side by side, and the transaction pooler shares its server connections, so each
// instance may hold 12 (5 queued a page's queries in rounds).
// Connections stay open 10 minutes idle and are renewed every 30: each new one costs a TLS
// handshake and sign-in (about 5 KB of Supabase egress), and with 20 s / 10 min the server opened
// about 1,850 a day, one for nearly every page view and every 5-minute health check (egress,
// 2026-11-21). An idle client of the transaction pooler holds no database connection.
const globalForDb = globalThis as unknown as { pg?: Pool };
function createPool() {
  const pool = new Pool({
    ...connectionConfig(process.env.DATABASE_URL!),
    max: 12,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10 * 60_000,
    maxLifetimeSeconds: 30 * 60,
  });
  // An idle connection the pooler drops (a restart, a network blip) is removed from the pool and
  // the next query opens a new one; without a listener the error would stop the server.
  pool.on("error", (err) => console.error("database: idle connection closed:", err.message));
  return pool;
}
const client = globalForDb.pg ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.pg = client;

export const db = drizzle(client, { schema });
export { schema };
