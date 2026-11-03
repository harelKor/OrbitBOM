import "server-only";
import { and, desc, eq, getTableColumns, getTableName, inArray, is, isNull, lt, sql, type SQL } from "drizzle-orm";
import { PgTable, getTableConfig, type PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import * as schema from "@/db/schema";
import type { DeletedRows } from "@/db/schema";
import { deleteObjects } from "@/lib/storage/cleanup";

// Recently deleted (2026-11-03): deleting a robot, system, manual part or inventory item first
// saves it and everything the database would cascade with it, so an admin can bring it all back
// for 30 days. Generic over the schema's foreign keys, so a new table that hangs off a part is
// kept without changes here.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = Tx | typeof db;
type Row = Record<string, unknown>;
type Kind = (typeof schema.deletedRecords.$inferSelect)["kind"];

export const KEEP_DAYS = 30;

const TABLES = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable) && v !== schema.deletedRecords);
const tableByName = new Map(TABLES.map((t) => [getTableName(t), t]));
const columnsOf = (t: PgTable) => getTableColumns(t) as Record<string, PgColumn>;
// The JS key of a database column name.
const keyOf = (t: PgTable, column: string) => Object.entries(columnsOf(t)).find(([, c]) => c.name === column)![0];
// Columns that identify a row: the primary key, or a composite one.
function keyColumns(t: PgTable): string[] {
  const single = Object.entries(columnsOf(t)).filter(([, c]) => c.primary).map(([k]) => k);
  if (single.length) return single;
  const composite = getTableConfig(t).primaryKeys[0];
  return composite ? composite.columns.map((c) => keyOf(t, c.name)) : Object.keys(columnsOf(t));
}

// Every single-column foreign key, with the table it's on.
const FKS = TABLES.flatMap((table) =>
  getTableConfig(table).foreignKeys.flatMap((fk) => {
    const ref = fk.reference();
    if (ref.columns.length !== 1) return [];
    return [{ table, column: ref.columns[0], target: ref.foreignTable as PgTable, targetColumn: ref.foreignColumns[0], onDelete: fk.onDelete ?? "no action" }];
  }),
);

// The rows `ids` of `root` and everything that cascades from them, parent-first, and the links
// that "set null" would empty.
async function collect(exec: Exec, root: PgTable, where: SQL): Promise<DeletedRows> {
  const tables: DeletedRows["tables"] = [];
  const links: DeletedRows["links"] = [];
  const seen = new Map<string, Set<string>>();
  const queue: { table: PgTable; rows: Row[] }[] = [{ table: root, rows: (await exec.select().from(root).where(where)) as Row[] }];
  while (queue.length) {
    const { table, rows } = queue.shift()!;
    const name = getTableName(table);
    const known = seen.get(name) ?? seen.set(name, new Set()).get(name)!;
    const keys = keyColumns(table);
    const fresh = rows.filter((r) => {
      const k = JSON.stringify(keys.map((c) => r[c]));
      return known.has(k) ? false : (known.add(k), true);
    });
    if (!fresh.length) continue;
    const entry = tables.find((t) => t.table === name);
    if (entry) entry.rows.push(...fresh);
    else tables.push({ table: name, rows: fresh });

    for (const fk of FKS.filter((f) => f.target === table)) {
      const values = [...new Set(fresh.map((r) => r[keyOf(table, fk.targetColumn.name)]).filter((v) => v != null))];
      if (!values.length) continue;
      if (fk.onDelete === "cascade") {
        const children = (await exec.select().from(fk.table).where(inArray(fk.column, values))) as Row[];
        if (children.length) queue.push({ table: fk.table, rows: children });
      } else if (fk.onDelete === "set null") {
        const childKeys = keyColumns(fk.table);
        const columnKey = keyOf(fk.table, fk.column.name);
        const linked = (await exec.select().from(fk.table).where(inArray(fk.column, values))) as Row[];
        for (const v of values) {
          const ids = linked.filter((r) => r[columnKey] === v).map((r) => Object.fromEntries(childKeys.map((c) => [c, r[c]])));
          if (ids.length) links.push({ table: getTableName(fk.table), column: columnKey, value: v, ids });
        }
      }
    }
  }
  // Rows a cascade reaches by two paths come out once; a table reached late (a part's history
  // through a merge) still has to follow its parents, so order by the foreign keys.
  return { tables: parentFirst(tables), links };
}

function parentFirst(tables: DeletedRows["tables"]) {
  const names = new Set(tables.map((t) => t.table));
  const done = new Set<string>();
  const out: DeletedRows["tables"] = [];
  let left = [...tables];
  while (left.length) {
    const ready = left.filter((t) =>
      FKS.every((f) => getTableName(f.table) !== t.table || !f.column.notNull || !names.has(getTableName(f.target)) || getTableName(f.target) === t.table || done.has(getTableName(f.target))),
    );
    const next = ready.length ? ready : [left[0]];
    for (const t of next) {
      out.push(t);
      done.add(t.table);
    }
    left = left.filter((t) => !next.includes(t));
  }
  return out;
}

// Saves what deleting `where` from `root` will remove, then deletes it, in the caller's transaction.
export async function deleteToTrash(
  tx: Tx,
  { kind, label, root, where, memberId, fileKeys = [] }: { kind: Kind; label: string; root: PgTable; where: SQL; memberId: string | null; fileKeys?: string[] },
) {
  const rows = await collect(tx, root, where);
  if (!rows.tables.length) return 0;
  await tx.insert(schema.deletedRecords).values({ kind, label, rows: rows as DeletedRows, fileKeys, deletedBy: memberId });
  return ((await tx.delete(root).where(where)).rowCount ?? 0) as number;
}

// JSON turned dates into text.
function revive(table: PgTable, row: Row): Row {
  const out: Row = {};
  for (const [k, c] of Object.entries(columnsOf(table))) {
    if (!(k in row)) continue;
    const v = row[k];
    out[k] = c.dataType === "date" && typeof v === "string" ? new Date(v) : v;
  }
  return out;
}

// Puts a deleted entry back: rows parent-first, each optional link first left empty and filled
// once everything is in (a system names its current version, which names the system), links
// to rows gone since stay empty, and links "set null" emptied are filled where still empty.
export async function restoreFromTrash(id: string): Promise<{ restored: number; label: string }> {
  return db.transaction(async (tx) => {
    const [entry] = await tx.select().from(schema.deletedRecords).where(eq(schema.deletedRecords.id, id)).for("update");
    if (!entry) throw new Error("That was already restored or has been purged.");
    const later: { table: PgTable; keys: Row; column: string; value: unknown; target: PgTable; targetColumn: PgColumn; owner: boolean }[] = [];
    let restored = 0;
    for (const { table: name, rows } of entry.rows.tables) {
      const table = tableByName.get(name);
      if (!table) continue;
      const keys = keyColumns(table);
      const fks = FKS.filter((f) => f.table === table);
      const values = rows.map((r) => revive(table, r));
      for (const fk of fks) {
        const col = keyOf(table, fk.column.name);
        const wanted = [...new Set(values.map((r) => r[col]).filter((v) => v != null))];
        if (!wanted.length) continue;
        if (!fk.column.notNull) {
          for (const r of values) {
            if (r[col] == null) continue;
            later.push({ table, keys: Object.fromEntries(keys.map((k) => [k, r[k]])), column: col, value: r[col], target: fk.target, targetColumn: fk.targetColumn, owner: fk.onDelete === "cascade" });
            r[col] = null;
          }
          continue;
        }
        const found = new Set((await tx.select({ v: fk.targetColumn }).from(fk.target).where(inArray(fk.targetColumn, wanted))).map((x) => x.v));
        const missing = wanted.filter((v) => !found.has(v));
        if (missing.length) throw new Error(`Can't restore "${entry.label}": what it belonged to (${getTableName(fk.target)}) was deleted too. Restore that first.`);
      }
      for (let i = 0; i < values.length; i += 500) {
        const res = await tx.insert(table).values(values.slice(i, i + 500)).onConflictDoNothing();
        restored += res.rowCount ?? 0;
      }
    }
    // The optional links. One to what owned the row (it would have cascaded: a part's system) that
    // is gone since stops the restore, rather than leaving the row orphaned; any other (a member
    // who left, an item deleted since) stays empty.
    for (const l of later) {
      const [hit] = await tx.select({ v: l.targetColumn }).from(l.target).where(eq(l.targetColumn, l.value)).limit(1);
      if (!hit && l.owner) {
        throw new Error(`Can't restore "${entry.label}": what it belonged to (${getTableName(l.target)}) was deleted too. Restore that first.`);
      }
      if (!hit) continue;
      const cols = columnsOf(l.table);
      await tx
        .update(l.table)
        .set({ [l.column]: l.value })
        .where(and(...Object.entries(l.keys).map(([k, v]) => eq(cols[k], v))));
    }
    for (const link of entry.rows.links) {
      const table = tableByName.get(link.table);
      if (!table) continue;
      const cols = columnsOf(table);
      for (const ids of link.ids) {
        await tx
          .update(table)
          .set({ [link.column]: link.value })
          .where(and(isNull(cols[link.column]), ...Object.entries(ids).map(([k, v]) => eq(cols[k], v))));
      }
    }
    await tx.delete(schema.deletedRecords).where(eq(schema.deletedRecords.id, id));
    return { restored, label: entry.label };
  });
}

// Settings → Recently deleted.
export async function listTrash() {
  return db
    .select({
      id: schema.deletedRecords.id,
      kind: schema.deletedRecords.kind,
      label: schema.deletedRecords.label,
      deletedAt: schema.deletedRecords.deletedAt,
      by: schema.members.name,
      rows: sql<number>`(select coalesce(sum(jsonb_array_length(t->'rows')), 0) from jsonb_array_elements(${schema.deletedRecords.rows}->'tables') t)::int`,
    })
    .from(schema.deletedRecords)
    .leftJoin(schema.members, eq(schema.members.id, schema.deletedRecords.deletedBy))
    .orderBy(desc(schema.deletedRecords.deletedAt));
}

// The nightly job: entries older than KEEP_DAYS go for good, with their R2 files.
export async function purgeTrash() {
  const old = await db
    .delete(schema.deletedRecords)
    .where(lt(schema.deletedRecords.deletedAt, sql`now() - make_interval(days => ${KEEP_DAYS})`))
    .returning({ fileKeys: schema.deletedRecords.fileKeys });
  await deleteObjects(old.flatMap((o) => o.fileKeys));
  return old.length;
}
