import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { categoryOf, getCategory } from "./categories";
import { listCategories } from "@/lib/data/categories";
import { currentVisit } from "@/lib/visits";
import { type Pieces, setPieceCount, snapStock, stepStock } from "./stock";

const { inventoryItems, inventoryMoves } = schema;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type StockReason = (typeof schema.stockReason.enumValues)[number];
export type MoveCtx = { memberId: string | null; via: "ui" | "sync" | "mcp"; aiName?: string | null; batchId?: string | null };

// The one way stock changes: the item's count and a line in inventory_moves, together. The amount
// is snapped (whole units, or twelfths of a sheet) and never goes below zero; the move records
// what actually changed. A fraction item's pieces move too: `bucket` (twelfths) steps one piece of
// that size. Returns the stock before and after.
export async function moveStock(
  tx: Tx,
  move: { itemId: string; delta: number; reason: StockReason; partId?: string | null; bucket?: number },
  ctx: MoveCtx,
): Promise<{ name: string; from: number; to: number } | null> {
  return changeStock(tx, move.itemId, (item) => stepStock(item, move.delta, move.bucket), move.reason, move.partId ?? null, ctx);
}

// One piece size's count set directly (the item window's Spread rows): a "Counted" move.
export async function setPieceStock(tx: Tx, itemId: string, twelfths: number, count: number, ctx: MoveCtx) {
  return changeStock(tx, itemId, (item) => (item.sheet ? setPieceCount(item, twelfths, count) : { inStock: item.inStock }), "counted", null, ctx);
}

async function changeStock(
  tx: Tx,
  itemId: string,
  next: (item: { inStock: number; sheet: boolean; pieces: Pieces }) => { inStock: number; pieces?: Pieces },
  reason: StockReason,
  partId: string | null,
  ctx: MoveCtx,
) {
  const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).for("update");
  if (!item) return null;
  const cats = await listCategories(tx);
  const sheet = !!getCategory(cats, categoryOf(item, cats))?.sheet;
  const after = next({ inStock: item.inStock, sheet, pieces: item.pieces });
  const to = snapStock(after.inStock, sheet);
  const pieces = after.pieces ?? item.pieces;
  if (to !== item.inStock || JSON.stringify(pieces) !== JSON.stringify(item.pieces)) {
    await tx.update(inventoryItems).set({ inStock: to, pieces }).where(eq(inventoryItems.id, item.id));
  }
  if (to !== item.inStock) {
    const visit = ctx.via === "ui" ? await currentVisit() : null;
    await tx.insert(inventoryMoves).values({
      itemId: item.id,
      delta: to - item.inStock,
      reason,
      partId,
      memberId: ctx.memberId,
      via: ctx.via,
      aiName: ctx.aiName ?? null,
      batchId: ctx.batchId ?? null,
      visitId: visit?.id,
      page: visit?.page,
    });
  }
  return { name: item.name, from: item.inStock, to };
}

// Set the stock to a counted amount (the item form, a stocktake).
export async function setStock(tx: Tx, itemId: string, amount: number, ctx: MoveCtx) {
  const [item] = await tx.select({ inStock: inventoryItems.inStock }).from(inventoryItems).where(eq(inventoryItems.id, itemId));
  if (!item) return null;
  return moveStock(tx, { itemId, delta: amount - item.inStock, reason: "counted" }, ctx);
}

// Reverse a batch's stock changes (undo_batch), as new moves in a new batch.
export async function undoMoves(tx: Tx, batchId: string, ctx: MoveCtx) {
  const rows = await tx.select().from(inventoryMoves).where(eq(inventoryMoves.batchId, batchId));
  for (const r of rows) await moveStock(tx, { itemId: r.itemId, delta: -r.delta, reason: "counted", partId: r.partId }, ctx);
  return rows.length;
}
