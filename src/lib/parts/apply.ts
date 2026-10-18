import "server-only";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { planPartUpdate, type PartChanges } from "./changes";

const { parts, partHistory } = schema;

// Applies the same changes to each part in one transaction and records every field change in
// part_history under one batch id, so the batch can be undone together. Returns the batch id
// and how many parts actually changed.
export async function applyPartChanges(
  partIds: string[],
  changes: PartChanges,
  ctx: { memberId: string | null; via: "ui" | "sync" | "mcp" },
): Promise<{ batchId: string; changed: number }> {
  const batchId = randomUUID();
  if (!partIds.length) return { batchId, changed: 0 };

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(parts).where(inArray(parts.id, partIds)).for("update");
    let changed = 0;
    for (const row of rows) {
      const { set, history } = planPartUpdate(row, changes, ctx.via);
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
    }
    return { batchId, changed };
  });
}
