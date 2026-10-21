import "server-only";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { currentVisit } from "@/lib/visits";

const { parts, partHistory } = schema;

type Revert = { partId: string; field: string; to: unknown; from: unknown };

// undo_batch (plan §6): put every field a batch changed back to its old value. A field that
// was changed again after the batch is left alone and reported, so an undo never overwrites
// someone's later edit. The undo is itself a new batch.
export async function planUndo(batchId: string) {
  const rows = await db.select().from(partHistory).where(eq(partHistory.batchId, batchId)).orderBy(asc(partHistory.at));
  if (!rows.length) return null;
  const current = await db
    .select()
    .from(parts)
    .where(inArray(parts.id, [...new Set(rows.map((r) => r.partId))]));
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const reverts: Revert[] = [];
  const skipped: Revert[] = [];
  for (const r of rows) {
    const part = current.find((p) => p.id === r.partId) as Record<string, unknown> | undefined;
    if (!part || !(r.field in part)) continue;
    const entry = { partId: r.partId, field: r.field, to: r.oldValue, from: part[r.field] };
    (same(part[r.field], r.newValue) ? reverts : skipped).push(entry);
  }
  return { reverts, skipped };
}

export async function applyUndo(reverts: Revert[], memberId: string, via: "ui" | "mcp") {
  const batchId = randomUUID();
  const visit = via === "ui" ? await currentVisit() : null;
  await db.transaction(async (tx) => {
    for (const partId of new Set(reverts.map((r) => r.partId))) {
      const mine = reverts.filter((r) => r.partId === partId);
      await tx
        .update(parts)
        .set({ ...Object.fromEntries(mine.map((r) => [r.field, r.to])), lastModifiedAt: new Date(), lastModifiedBy: memberId })
        .where(eq(parts.id, partId));
      await tx.insert(partHistory).values(
        mine.map((r) => ({ partId, field: r.field, oldValue: r.from, newValue: r.to, memberId, via, batchId, visitId: visit?.id, page: visit?.page })),
      );
    }
  });
  return batchId;
}
