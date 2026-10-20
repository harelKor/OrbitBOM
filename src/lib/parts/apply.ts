import "server-only";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { planPartUpdate, type PartChanges, type Plan } from "./changes";

const { parts, partHistory } = schema;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Ctx = {
  memberId: string | null;
  via: "ui" | "sync" | "mcp";
  // Runs in the same transaction for each part that changed (To Review records its rows here).
  afterEach?: (tx: Tx, row: typeof parts.$inferSelect, plan: Plan) => Promise<void>;
};

// Applies the same changes to each part in one transaction and records every field change in
// part_history under one batch id, so the batch can be undone together. Returns the batch id
// and how many parts actually changed.
export function applyPartChanges(
  partIds: string[],
  changes: PartChanges,
  ctx: Ctx,
) {
  return applyEachPartChanges(
    partIds.map((id) => ({ id, changes })),
    ctx,
  );
}

// The same, with different changes per part (a merged row's edit fanned out to its members).
export async function applyEachPartChanges(
  edits: { id: string; changes: PartChanges }[],
  ctx: Ctx,
): Promise<{ batchId: string; changed: number }> {
  const batchId = randomUUID();
  if (!edits.length) return { batchId, changed: 0 };
  const byId = new Map(edits.map((e) => [e.id, e.changes]));

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(parts).where(inArray(parts.id, [...byId.keys()])).for("update");
    let changed = 0;
    for (const row of rows) {
      const plan = planPartUpdate(row, byId.get(row.id)!, ctx.via);
      const { set, history } = plan;
      if (!history.length) continue;
      changed++;
      await tx
        .update(parts)
        .set({ ...set, lastModifiedAt: new Date(), lastModifiedBy: ctx.memberId })
        .where(eq(parts.id, row.id));
      await tx.insert(partHistory).values(
        history.map((h) => ({
          partId: row.id,
          field: h.field,
          oldValue: h.oldValue,
          newValue: h.newValue,
          memberId: ctx.memberId,
          via: ctx.via,
          batchId,
        })),
      );
      await ctx.afterEach?.(tx, row, plan);
    }
    return { batchId, changed };
  });
}
