import "server-only";
import { cache as perRender } from "react";
import { db, schema } from "@/db";

// Reads the server keeps in memory until their tables change. Supabase Free allows 5 GB of
// egress a month, and the app went to 9.4 GB re-reading the same small tables (the whole
// inventory, every part's status, the categories) on every page view and save (Harel,
// 2026-11-11). The site is one long-running Node process (deploy/), so memory survives between
// requests.
//
// `data_versions` holds one counter per watched table; a deferred trigger (migration 0083) adds
// one when a transaction that wrote the table commits, so the counter shows up together with the
// rows. Each read checks the counters (one tiny query, shared by a whole page render) and reuses
// what it loaded under the same counters. Writes from anywhere (the app, MCP, SQL in the
// dashboard) bump them, so nothing is stale.

export type Watched =
  | "inventory_items"
  | "inventory_categories"
  | "base_materials"
  | "parts"
  | "systems"
  | "robots"
  | "members"
  | "part_drawings"
  | "part_reviews";

// null when the counters can't be read (the migration hasn't run yet): every read goes to the
// database as before.
async function readVersions(): Promise<Map<string, number> | null> {
  try {
    const rows = await db.select().from(schema.dataVersions);
    return new Map(rows.map((r) => [r.name, r.version]));
  } catch {
    return null;
  }
}
// Once per server render; route handlers and actions read them per call.
const versions = perRender(readVersions);

type Entry = { stamp: string; value: unknown };
const MAX_ENTRIES = 300;
const store = new Map<string, Entry>();
// Loads in flight, so a burst of requests (the layout and a page side by side) reads once.
const loading = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, tables: Watched[], load: () => Promise<T>): Promise<T> {
  const v = await versions();
  if (!v) return load();
  const stamp = tables.map((t) => v.get(t) ?? "-").join(".");
  const hit = store.get(key);
  if (hit?.stamp === stamp) {
    // Most recently used last, so the oldest goes first when the store is full.
    store.delete(key);
    store.set(key, hit);
    // A copy: callers may change what they get (add a picture link, sort).
    return structuredClone(hit.value) as T;
  }
  const id = `${stamp}|${key}`;
  let pending = loading.get(id) as Promise<T> | undefined;
  if (!pending) {
    pending = load().then((value) => {
      store.delete(key);
      store.set(key, { stamp, value });
      if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value!);
      return value;
    });
    loading.set(id, pending);
    pending.then(
      () => loading.delete(id),
      () => loading.delete(id),
    );
  }
  // Every caller gets its own copy, the stored value stays untouched.
  return structuredClone(await pending);
}

// A Drizzle select kept under its own SQL and parameters.
export function cachedQuery<T>(query: PromiseLike<T> & { toSQL(): { sql: string; params: unknown[] } }, tables: Watched[]): Promise<T> {
  const { sql, params } = query.toSQL();
  return cached(`q:${sql}:${JSON.stringify(params)}`, tables, async () => await query);
}

// For tests.
export function clearCache() {
  store.clear();
  loading.clear();
}
