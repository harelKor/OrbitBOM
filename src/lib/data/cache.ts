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
  | "bores"
  | "parts"
  | "systems"
  | "robots"
  | "members"
  | "part_drawings"
  | "part_reviews"
  | "inventory_groups"
  | "inventory_conditions"
  | "inventory_locations"
  | "material_colors"
  | "system_versions";

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

// Kept by count and by an estimated size: a few big reads (every part of the team, the whole
// shelf) could otherwise fill the small server's memory (audit, 2026-11-14). The estimate is the
// value's JSON length times 3, about what V8's objects take for this kind of row data.
type Entry = { stamp: string; value: unknown; bytes: number };
const MAX_ENTRIES = 300;
const MAX_BYTES = 200 * 2 ** 20;
const store = new Map<string, Entry>();
let storedBytes = 0;
// Loads in flight, so a burst of requests (the layout and a page side by side) reads once.
const loading = new Map<string, Promise<unknown>>();

function sizeOf(value: unknown): number {
  try {
    return (JSON.stringify(value)?.length ?? 0) * 3;
  } catch {
    return MAX_BYTES; // can't tell (a cycle, a BigInt): not kept
  }
}

function forget(key: string) {
  const old = store.get(key);
  if (!old) return;
  store.delete(key);
  storedBytes -= old.bytes;
}

function keep(key: string, stamp: string, value: unknown) {
  forget(key);
  const bytes = sizeOf(value);
  if (bytes > MAX_BYTES / 4) return; // one read that big isn't worth pushing everything else out
  store.set(key, { stamp, value, bytes });
  storedBytes += bytes;
  while (store.size > MAX_ENTRIES || storedBytes > MAX_BYTES) forget(store.keys().next().value!);
}

export async function cached<T>(key: string, tables: Watched[], load: () => Promise<T>): Promise<T> {
  const v = await versions();
  // A table without a counter isn't watched yet (its migration hasn't run): nothing would tell
  // the kept copy it's stale, so it reads the database as before.
  if (!v || tables.some((t) => !v.has(t))) return load();
  const stamp = tables.map((t) => v.get(t)).join(".");
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
      keep(key, stamp, value);
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

// A cached list of rows of one table (with joins) that reloads only the rows that changed when
// only that table's counter moved (audit 2026-11-25 PERF-9): one To Fab "+" used to re-read every
// column of every part of the robot. Postgres gives each row version a new `xmin`, so a manifest
// of (id, xmin) in the list's own order (~60 B a row) tells which rows to fetch again; rows that
// left the list drop out, new ones come in. Any other watched table moving reloads it all.
// `all` must return each row's id and xmin (`"parts"."xmin"::text`); `manifest` the same ids and
// xmins under the same joins, filter and order; `some` the full rows of the given ids.
type Versioned = { id: string; v: string };
export async function cachedRows<R>(
  table: Watched,
  tables: Watched[],
  q: {
    all: PromiseLike<R[]> & { toSQL(): { sql: string; params: unknown[] } };
    manifest: () => PromiseLike<Versioned[]>;
    some: (ids: string[]) => PromiseLike<R[]>;
    idOf: (row: R) => string;
    vOf: (row: R) => string;
  },
): Promise<R[]> {
  const { sql, params } = q.all.toSQL();
  const key = `rows:${sql}:${JSON.stringify(params)}`;
  const v = await versions();
  if (!v || tables.some((t) => !v.has(t)) || !tables.includes(table)) return await q.all;
  const stamp = tables.map((t) => v.get(t)).join(".");
  const hit = store.get(key);
  if (hit?.stamp === stamp) {
    store.delete(key);
    store.set(key, hit);
    return structuredClone(hit.value) as R[];
  }
  const id = `${stamp}|${key}`;
  let pending = loading.get(id) as Promise<R[]> | undefined;
  if (!pending) {
    const before = hit?.stamp.split(".");
    const now = stamp.split(".");
    const onlyOurs = !!before && before.length === now.length && tables.every((t, i) => t === table || before[i] === now[i]);
    pending = (onlyOurs ? reloadChanged(hit!.value as R[], q) : Promise.resolve(q.all)).then((value) => {
      keep(key, stamp, value);
      return value;
    });
    loading.set(id, pending);
    pending.then(
      () => loading.delete(id),
      () => loading.delete(id),
    );
  }
  return structuredClone(await pending);
}

async function reloadChanged<R>(old: R[], q: Parameters<typeof cachedRows<R>>[2]): Promise<R[]> {
  const manifest = await q.manifest();
  const kept = new Map<string, R[]>();
  for (const row of old) {
    const k = q.idOf(row);
    const list = kept.get(k);
    if (list) list.push(row);
    else kept.set(k, [row]);
  }
  const changed = new Set(manifest.filter((m) => !kept.has(m.id) || q.vOf(kept.get(m.id)![0]) !== m.v).map((m) => m.id));
  // Most of the list changed (a bulk edit, a BOM update): one full read is cheaper.
  if (changed.size > manifest.length / 3) return await q.all;
  const fresh = new Map<string, R[]>();
  if (changed.size) {
    for (const row of await q.some([...changed])) {
      const k = q.idOf(row);
      const list = fresh.get(k);
      if (list) list.push(row);
      else fresh.set(k, [row]);
    }
  }
  const out: R[] = [];
  const seen = new Set<string>();
  for (const m of manifest) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(...((changed.has(m.id) ? fresh.get(m.id) : kept.get(m.id)) ?? []));
  }
  return out;
}

// For tests.
export function clearCache() {
  store.clear();
  storedBytes = 0;
  loading.clear();
}

// For tests: how much is kept.
export function cacheStats() {
  return { entries: store.size, bytes: storedBytes };
}
