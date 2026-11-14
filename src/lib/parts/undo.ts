import "server-only";
import { randomUUID } from "node:crypto";
import { SQL, and, asc, eq, getTableColumns, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { undoMoves } from "@/lib/inventory/moves";
import { fileKeysFor } from "@/lib/storage/cleanup";
import { deleteToTrash } from "@/lib/trash";
import { applyEachPartChanges } from "./apply";
import type { Plan } from "./changes";

const { parts, partHistory } = schema;

type Revert = { partId: string; field: string; to: unknown; from: unknown };

// The history row a manual part is added with (addManualPart): not a column.
export const CREATED = "created";

// undo_batch (plan §6): put every field a batch changed back to its old value. A field that
// was changed again after the batch is left alone and reported, so an undo never overwrites
// someone's later edit. The undo is itself a new batch.
export async function planUndo(batchId: string) {
  return planUndoRows(await db.select().from(partHistory).where(eq(partHistory.batchId, batchId)).orderBy(asc(partHistory.at)));
}

// The same for every change made in one page visit (Recent actions' Revert).
export async function planUndoVisit(visitId: string) {
  return planUndoRows(await db.select().from(partHistory).where(eq(partHistory.visitId, visitId)).orderBy(asc(partHistory.at)));
}

// A field changed several times goes back to its value before the first change, and only
// when it still holds the value of the last one.
async function planUndoRows(rows: (typeof partHistory.$inferSelect)[]) {
  if (!rows.length) return null;
  const current = await db
    .select()
    .from(parts)
    .where(inArray(parts.id, [...new Set(rows.map((r) => r.partId))]));
  const span = new Map<string, { first: (typeof rows)[number]; last: (typeof rows)[number] }>();
  for (const r of rows) {
    const k = `${r.partId}|${r.field}`;
    const s = span.get(k);
    span.set(k, { first: s?.first ?? r, last: r });
  }
  const reverts: Revert[] = [];
  const skipped: Revert[] = [];
  for (const { first, last } of span.values()) {
    const part = current.find((p) => p.id === first.partId) as Record<string, unknown> | undefined;
    // A part added by hand in the batch: undoing it moves it to Recently deleted.
    if (first.field === CREATED) {
      if (part?.isManual) reverts.push({ partId: first.partId, field: CREATED, to: null, from: null });
      continue;
    }
    if (!part || !(first.field in part)) continue;
    if (same(first.oldValue, last.newValue)) continue;
    const entry = { partId: first.partId, field: first.field, to: first.oldValue, from: part[first.field] };
    (same(part[first.field], last.newValue) ? reverts : skipped).push(entry);
  }
  return { reverts, skipped, batches: [...new Set(rows.map((r) => r.batchId))] };
}

// The value an undo writes back: a field recorded as empty that can't be empty gets its default
// (no links, no fabricators, 0) instead of breaking the whole undo.
const columns = getTableColumns(parts) as Record<string, { notNull: boolean; hasDefault: boolean; default: unknown }>;
export function restorable(field: string, to: unknown) {
  if (to !== null && to !== undefined) return to;
  if (field === "classification") return "undefined"; // nobody has said yet, not In-house
  const col = columns[field];
  return col?.notNull && col.hasDefault && !(col.default instanceof SQL) ? col.default : null;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// `batches`: the batches being undone. Their stock moves (an order arriving on the shelf) go back
// with the status that made them, in the same transaction.
export async function applyUndo(reverts: Revert[], memberId: string, via: "ui" | "mcp", batches: string[] = []) {
  const batchId = randomUUID();
  await db.transaction(async (tx) => {
    const { applied } = await applyUndoIn(tx, reverts, { memberId, via, batchId });
    // Only for parts whose status went back: a status changed again since keeps its stock too.
    const back = new Set(applied.filter((r) => r.field === "designState").map((r) => r.partId));
    if (back.size && batches.length) await undoMoves(tx, batches, { memberId, via, batchId }, (m) => !!m.partId && back.has(m.partId));
  });
  return batchId;
}

// The undo inside a caller's transaction, through applyEachPartChanges so it keeps what a normal
// edit keeps up (a release lock, finished / arrived dates, the arrival glow, the linked item's
// links and price, the COTS Order History card). Each part is locked first and a field is put back
// only if it still holds the value the plan saw: an edit that landed after planning is kept
// (counted in `kept`), never overwritten. Stock isn't moved here (receive: false): the caller
// reverses the undone batch's moves.
export async function applyUndoIn(tx: Tx, reverts: Revert[], { memberId, via, batchId }: { memberId: string; via: "ui" | "mcp"; batchId: string }) {
  let kept = 0;
  const applied: Revert[] = [];
  const byPart = new Map<string, Revert[]>();
  const created = new Set(reverts.filter((r) => r.field === CREATED).map((r) => r.partId));
  for (const r of reverts) if (!created.has(r.partId)) byPart.set(r.partId, [...(byPart.get(r.partId) ?? []), r]);
  // Parts the batch added go to Recently deleted (30 days), whatever was edited on them since.
  for (const partId of created) {
    const where = and(eq(parts.id, partId), eq(parts.isManual, true))!;
    const [part] = await tx.select({ name: parts.displayName, onshapeName: parts.onshapeName }).from(parts).where(where).for("update");
    if (!part) continue;
    const fileKeys = await fileKeysFor({ partId });
    if (await deleteToTrash(tx, { kind: "part", label: part.name ?? part.onshapeName ?? "Manual part", root: parts, where, memberId, fileKeys })) applied.push(...reverts.filter((r) => r.partId === partId));
  }
  await applyEachPartChanges(
    [...byPart.keys()].map((id) => ({ id, changes: {} })),
    {
      memberId,
      via,
      batchId,
      tx,
      receive: false,
      plan: (row) => {
        const now = row as unknown as Record<string, unknown>;
        const all = byPart.get(row.id) ?? [];
        const mine = all.filter((r) => same(now[r.field], r.from));
        kept += all.length - mine.length;
        applied.push(...mine);
        const set = Object.fromEntries(mine.map((r) => [r.field, restorable(r.field, r.to)]));
        return { set: set as Plan["set"], history: mine.map((r) => ({ field: r.field, oldValue: now[r.field] ?? null, newValue: set[r.field] ?? null })) };
      },
    },
  );
  return { kept, applied };
}
