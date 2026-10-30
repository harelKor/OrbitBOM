import "server-only";
import { db, schema } from "@/db";
import { currentVisit } from "@/lib/visits";
import type { MoveCtx } from "./moves";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// The item fields the history keeps (stock has its own moves).
export const ITEM_FIELDS = ["name", "category", "specs", "locationId", "conditionId", "cotsLinks", "price", "imagePath", "seasonNeed", "note", "seasonTag"] as const;
type ItemValues = Partial<Record<(typeof ITEM_FIELDS)[number], unknown>>;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Write the item's history: "created" for a new item (before is null), else one row per field
// that changed.
export async function recordItemChanges(tx: Tx | typeof db, itemId: string, before: ItemValues | null, after: ItemValues, ctx: MoveCtx) {
  const rows = before
    ? ITEM_FIELDS.filter((f) => f in after && !same(before[f], after[f])).map((f) => ({ field: f, oldValue: before[f] ?? null, newValue: after[f] ?? null }))
    : [{ field: "created", oldValue: null, newValue: after.name ?? null }];
  if (!rows.length) return;
  const visit = ctx.via === "ui" ? await currentVisit() : null;
  await tx.insert(schema.inventoryItemHistory).values(
    rows.map((r) => ({ itemId, ...r, memberId: ctx.memberId, via: ctx.via, aiName: ctx.aiName ?? null, batchId: ctx.batchId ?? null, visitId: visit?.id, page: visit?.page })),
  );
}
