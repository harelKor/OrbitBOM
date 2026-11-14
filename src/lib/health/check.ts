import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { CATEGORY_GROUPS } from "@/config/inventory";
import { BACKUP_DAYS, DATABASE_LIMIT, STORAGE_LIMIT } from "@/config/storage";
import journal from "../../../drizzle/meta/_journal.json";
import { listObjects, storageConfigured } from "@/lib/storage/r2";
import { migrationState } from "./status";

// A read-only health check of the live database and R2 (season readiness, 2026-10-28): broken
// references, missing indexes, migrations, sizes and what the nightly jobs left behind. It only
// reads; every problem is reported, none is fixed here.

const rows = async <T>(query: ReturnType<typeof sql>) => (await db.execute(query)).rows as T[];
const one = async <T>(query: ReturnType<typeof sql>) => (await rows<T>(query))[0];

// The indexes busy pages lean on: table → leading columns.
const WANTED_INDEXES: [string, string[]][] = [
  ["parts", ["system_id"]],
  ["parts", ["inventory_item_id"]],
  ["group_members", ["part_id"]],
  ["part_reviews", ["batch_id"]],
  ["part_history", ["part_id", "at"]],
  ["part_history", ["at"]],
  ["inventory_moves", ["item_id", "at"]],
  // Migration 0093: the layout's arrivals, and foreign keys Postgres checks on every delete.
  ["parts", ["stage_at"]],
  ["parts", ["released_version_id"]],
  ["inventory_moves", ["part_id"]],
  ["review_comments", ["done_version_id"]],
  ["part_releases", ["version_id"]],
  ["cad_updates", ["robot_id"]],
];

export async function healthCheck() {
  const groups = CATEGORY_GROUPS.map((g) => g.id);
  const groupList = sql.join(groups.map((g) => sql`${g}`), sql`, `);

  const integrity = await one<Record<string, number>>(sql`
    select
      (select count(*)::int from inventory_items i where i.category is not null and not exists (select 1 from inventory_categories c where c.id = i.category)) as items_unknown_category,
      (select count(*)::int from inventory_items where category is null) as items_no_category,
      (select count(*)::int from parts p where p.cots_category is not null and not exists (select 1 from inventory_categories c where c.id = p.cots_category)) as parts_unknown_cots_category,
      (select count(*)::int from inventory_categories where "group" is null or "group" not in (${groupList})) as categories_bad_group,
      (select count(*)::int from inventory_items i where i.condition_id is not null and not exists (select 1 from inventory_conditions c where c.id = i.condition_id)) as items_missing_condition,
      (select count(*)::int from inventory_items i where i.location_id is not null and not exists (select 1 from inventory_locations l where l.id = i.location_id)) as items_missing_location,
      (select count(*)::int from parts where cots_links is null or jsonb_typeof(cots_links) <> 'array') as parts_bad_cots_links,
      (select count(*)::int from inventory_items where cots_links is null or jsonb_typeof(cots_links) <> 'array') as items_bad_cots_links,
      (select count(*)::int from parts p where p.inventory_item_id is not null and not exists (select 1 from inventory_items i where i.id = p.inventory_item_id)) as parts_missing_item,
      (select count(*)::int from group_members g where not exists (select 1 from parts p where p.id = g.part_id)) as group_members_missing_part,
      (select count(*)::int from part_reviews r where not exists (select 1 from parts p where p.id = r.part_id)) as reviews_missing_part,
      (select count(*)::int from parts where fabricators is null or jsonb_typeof(fabricators) <> 'object') as parts_bad_fabricators,
      (select count(*)::int from parts where quantity < 0 or done_preprocess < 0 or done_process1 < 0 or done_process2 < 0 or post_done < 0) as parts_negative_counts,
      (select count(*)::int from parts where system_id is null and robot_id is null and classification <> 'cots') as loose_non_cots_parts,
      (select count(*)::int from systems s where s.refresh_member_id is not null and not exists (select 1 from onshape_tokens t where t.member_id = s.refresh_member_id)) as systems_refresh_account_gone,
      (select count(*)::int from part_reviews where changes is null or pending is null) as reviews_null_json,
      (select count(*)::int from part_history h join information_schema.columns c on c.table_name = 'parts' and c.column_name = lower(regexp_replace(h.field, '([A-Z])', '_\\1', 'g')) and c.is_nullable = 'NO'
         where h.old_value is null or h.old_value = 'null'::jsonb) as history_null_into_required
  `);

  const indexDefs = await rows<{ table: string; columns: string[] }>(sql`
    select t.relname as "table", array_agg(a.attname::text order by k.ord) as columns
    from pg_index x
    join pg_class t on t.oid = x.indrelid
    join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
    cross join lateral unnest(x.indkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
    group by x.indexrelid, t.relname
  `);
  const indexes = WANTED_INDEXES.map(([table, cols]) => ({
    index: `${table}(${cols.join(", ")})`,
    present: indexDefs.some((d) => d.table === table && cols.every((c, i) => d.columns[i] === c)),
  }));

  const state = await migrationState();
  const migrations = { inRepo: state.expected, applied: state.applied, latestInRepo: journal.entries[journal.entries.length - 1].tag, missing: state.missing, ahead: state.ahead, inSync: state.inSync };

  const tableRows = await rows<{ table: string; rows: number; bytes: number }>(sql`
    select c.relname as "table", c.reltuples::bigint::int as rows, pg_total_relation_size(c.oid)::bigint::int as bytes
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' order by bytes desc
  `);
  const exact = await one<Record<string, number>>(sql`
    select
      (select count(*)::int from robots) as robots,
      (select count(*)::int from systems) as systems,
      (select count(*)::int from parts) as parts,
      (select count(*)::int from parts where removed_from_cad_at is null) as parts_in_cad,
      (select count(*)::int from parts where classification = 'cots') as cots_parts,
      (select count(*)::int from inventory_items) as inventory_items,
      (select count(*)::int from inventory_categories) as inventory_categories,
      (select count(*)::int from members) as members,
      (select count(*)::int from members where onshape_connected) as onshape_connected,
      (select count(*)::int from part_history) as part_history,
      (select count(*)::int from inventory_moves) as inventory_moves,
      (select count(*)::int from sync_jobs) as sync_jobs,
      (select count(*)::int from sync_jobs where started_at < now() - interval '14 days') as sync_jobs_over_14_days,
      (select count(*)::int from dismissed_actions) as dismissed_actions,
      (select count(*)::int from dismissed_actions where at < now() - interval '14 days') as dismissed_over_14_days,
      (select max(last_checked_at)::text from systems) as last_system_check,
      (select max(started_at)::text from sync_jobs) as last_sync_job
  `);
  const dbBytes = await one<{ bytes: number }>(sql`select pg_database_size(current_database())::bigint as bytes`);

  const byGroup = await rows<{ group: string; categories: number; items: number }>(sql`
    select c."group", count(distinct c.id)::int as categories, count(i.id)::int as items
    from inventory_categories c left join inventory_items i on i.category = c.id
    group by c."group" order by c."group"
  `);
  const byCategory = await rows<{ group: string; category: string; items: number }>(sql`
    select c."group", c.id as category, count(i.id)::int as items
    from inventory_categories c left join inventory_items i on i.category = c.id
    group by c."group", c.id order by c."group", items desc
  `);

  const ledger = await rows<{ kind: string; files: number; bytes: number }>(
    sql`select kind, count(*)::int as files, coalesce(sum(bytes), 0)::bigint as bytes from stored_files group by kind order by bytes desc`,
  );
  let backups: { key: string; bytes: number; modified: string }[] | { error: string } = [];
  if (storageConfigured()) {
    backups = await listObjects("backups/")
      .then((list) => list.map((o) => ({ key: o.key, bytes: o.bytes, modified: o.modified.toISOString() })).sort((a, b) => b.key.localeCompare(a.key)))
      .catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
  }
  const r2Bytes = ledger.reduce((n, l) => n + Number(l.bytes), 0);

  return {
    at: new Date().toISOString(),
    integrity,
    indexes,
    migrations,
    counts: exact,
    database: { bytes: Number(dbBytes.bytes), limit: DATABASE_LIMIT, percent: Math.round((Number(dbBytes.bytes) / DATABASE_LIMIT) * 1000) / 10 },
    tables: tableRows.slice(0, 15),
    inventory: { byGroup, byCategory },
    r2: {
      configured: storageConfigured(),
      bytes: r2Bytes,
      limit: STORAGE_LIMIT,
      percent: Math.round((r2Bytes / STORAGE_LIMIT) * 1000) / 10,
      byKind: ledger,
      backupDays: BACKUP_DAYS,
      backups: Array.isArray(backups) ? backups.slice(0, 5) : backups,
      backupCount: Array.isArray(backups) ? backups.length : null,
    },
  };
}
