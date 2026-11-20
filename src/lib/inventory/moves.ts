import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { categoryOf, getCategory, type InvCategory } from "./categories";
import { listCategories } from "@/lib/data/categories";
import { currentVisit } from "@/lib/visits";
import { type PieceOp, type PieceRow, type StoredPieces, applyPieceOp, countPieces, snapStock, stepStock } from "./stock";

const { inventoryDevices, inventoryItems, inventoryMoves } = schema;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type StockReason = (typeof schema.stockReason.enumValues)[number];
// `cats`: the categories, when the caller read them (cached) before opening the transaction: a
// stock tap then doesn't re-read the three settings tables under the row lock (2026-11-14).
export type MoveCtx = { memberId: string | null; via: "ui" | "sync" | "mcp"; aiName?: string | null; batchId?: string | null; cats?: InvCategory[] };

// The one way stock changes: the item's count and a line in inventory_moves, together. The amount
// is snapped (whole units, or twelfths of a sheet) and never goes below zero; the move records
// what actually changed. A fraction item's pieces move too: `bucket` (twelfths) steps one piece of
// that size. Returns the stock before and after.
export async function moveStock(
  tx: Tx,
  // `deviceId`: a devices item's − takes off that device (the item window asks which one).
  move: { itemId: string; delta: number; reason: StockReason; partId?: string | null; size?: string; deviceId?: string },
  ctx: MoveCtx,
): Promise<{ name: string; from: number; to: number } | null> {
  return changeStock(tx, move.itemId, (item) => stepStock(item, move.delta, move.size), move.reason, move.partId ?? null, ctx, move.deviceId);
}

// The Spread's edits (a size's count, ✏, ✕, a new size): a "Counted" move when the stock changes.
export async function editPieces(tx: Tx, itemId: string, op: PieceOp, ctx: MoveCtx) {
  return changeStock(tx, itemId, (item) => (item.sheet ? applyPieceOp(item, op) : { inStock: item.inStock }), "counted", null, ctx);
}

async function changeStock(
  tx: Tx,
  itemId: string,
  next: (item: { inStock: number; sheet: boolean; pieces: StoredPieces; specs: Record<string, string>; name: string }) => { inStock: number; pieces?: PieceRow[] },
  reason: StockReason,
  partId: string | null,
  ctx: MoveCtx,
  deviceId?: string,
) {
  const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).for("update");
  if (!item) return null;
  const cats = ctx.cats ?? (await listCategories(tx));
  const cat = getCategory(cats, categoryOf(item, cats));
  const sheet = !!cat?.sheet;
  const after = next({ inStock: item.inStock, sheet, pieces: item.pieces, specs: item.specs, name: item.name });
  // A fraction item's stock is its pieces' sum (a custom size can be any share), so it isn't snapped.
  const to = sheet ? Math.max(0, after.inStock) : snapStock(after.inStock, sheet);
  if (cat?.devices) await fitDevices(tx, item.id, to, deviceId);
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

// A devices item's stock is how many devices it has (Computers & Devices, Harel 2026-11-20): a
// new one stands in the middle of the zone's picture; fewer take off `remove` first, then the
// newest. Run under the item's row lock, so two phones tapping at once can't miss a row.
export async function fitDevices(tx: Tx, itemId: string, count: number, remove?: string) {
  const rows = await tx.select({ id: inventoryDevices.id, position: inventoryDevices.position }).from(inventoryDevices).where(eq(inventoryDevices.itemId, itemId)).orderBy(desc(inventoryDevices.position), desc(inventoryDevices.createdAt));
  if (rows.length < count) {
    const top = rows[0]?.position ?? -1;
    await tx.insert(inventoryDevices).values(Array.from({ length: count - rows.length }, (_, i) => ({ itemId, position: top + 1 + i })));
  } else if (rows.length > count) {
    const first = rows.filter((r) => r.id === remove);
    const gone = [...first, ...rows.filter((r) => r.id !== remove)].slice(0, rows.length - count).map((r) => r.id);
    await tx.delete(inventoryDevices).where(inArray(inventoryDevices.id, gone));
  }
}

// Set the stock to a counted amount (the item form, a stocktake). Worked out on the locked row,
// the way the page shows it (countPieces): a + that lands meanwhile can't be lost, and a sheet
// item keeps the amount typed rather than stepping one piece of it.
export async function setStock(tx: Tx, itemId: string, amount: number, ctx: MoveCtx) {
  return changeStock(tx, itemId, (item) => countPieces(item, amount), "counted", null, ctx);
}

// Reverse a batch's stock changes (undo_batch, Undo, Revert), as new moves in a new batch.
// `only` picks some of them (the parts whose status an undo put back).
export async function undoMoves(tx: Tx, batchId: string | string[], ctx: MoveCtx, only?: (move: typeof inventoryMoves.$inferSelect) => boolean) {
  const ids = typeof batchId === "string" ? [batchId] : batchId;
  if (!ids.length) return 0;
  const rows = (await tx.select().from(inventoryMoves).where(inArray(inventoryMoves.batchId, ids)).orderBy(asc(inventoryMoves.at))).filter((r) => !only || only(r));
  for (const r of rows) await moveStock(tx, { itemId: r.itemId, delta: -r.delta, reason: "counted", partId: r.partId }, ctx);
  return rows.length;
}
