import "server-only";
import { randomUUID } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { categoryOf, getCategory, type InvCategory } from "./categories";
import { listCategories } from "@/lib/data/categories";
import { currentVisit } from "@/lib/visits";
import { stationRoom } from "@/config/stations";
import { type PieceOp, type PieceRow, type StoredPieces, applyPieceOp, countPieces, snapStock, stepStock } from "./stock";
import { type ItemVariant, type VariantOp, applyVariantOp, countVariants, countingSum, stepVariants, storedVariants, variantMoves, variantsAllowed } from "./variants";

const { inventoryConditions, inventoryDevices, inventoryItems, inventoryMoves } = schema;

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
  // `variantId`: an item with variants (lib/inventory/variants.ts) moves that one when it counts,
  // else its first counting variant.
  move: { itemId: string; delta: number; reason: StockReason; partId?: string | null; size?: string; deviceId?: string; variantId?: string | null },
  ctx: MoveCtx,
): Promise<{ name: string; from: number; to: number } | null> {
  return changeStock(tx, move.itemId, (item) => stepStock(item, move.delta, move.size), move.reason, move.partId ?? null, ctx, move.deviceId, (v, unc) =>
    stepVariants(v, snapStock(Math.abs(move.delta), false) * Math.sign(move.delta), unc, move.variantId, randomUUID),
  );
}

// The Spread's edits (a size's count, ✏, ✕, a new size): a "Counted" move when the stock changes.
export async function editPieces(tx: Tx, itemId: string, op: PieceOp, ctx: MoveCtx) {
  return changeStock(tx, itemId, (item) => (item.sheet ? applyPieceOp(item, op) : { inStock: item.inStock }), "counted", null, ctx);
}

// The item window's variant edits (+ Add variant, a variant's condition, count, note, ✕): each
// counting variant whose amount changes is a "Counted" move ("Broke" when it was marked
// Defective). Not on Raw Stock, which has pieces instead (refused by variantsAllowed).
export async function editVariants(tx: Tx, itemId: string, op: VariantOp, ctx: MoveCtx) {
  const step: VariantStep = (v, _unc, item) => {
    const out = applyVariantOp({ inStock: item.inStock, conditionId: item.conditionId, variants: v }, op, randomUUID);
    return out.conditionId !== undefined ? { variants: out.variants, conditionId: out.conditionId } : out.variants;
  };
  return changeStock(tx, itemId, (item) => ({ inStock: item.inStock }), "counted", null, ctx, undefined, step, true);
}

// The conditions whose stock counts toward nothing (Defective), read under the item's lock.
async function uncountedIds(tx: Tx) {
  const rows = await tx.select({ id: inventoryConditions.id }).from(inventoryConditions).where(eq(inventoryConditions.uncounted, true));
  return new Set(rows.map((r) => r.id));
}

type Locked = typeof inventoryItems.$inferSelect;
type VariantStep = (variants: ItemVariant[], uncounted: Set<string>, item: Locked) => ItemVariant[] | { variants: ItemVariant[]; conditionId: string | null };

async function changeStock(
  tx: Tx,
  itemId: string,
  next: (item: { inStock: number; sheet: boolean; pieces: StoredPieces; specs: Record<string, string>; name: string; category?: string | null }) => { inStock: number; pieces?: PieceRow[] },
  reason: StockReason,
  partId: string | null,
  ctx: MoveCtx,
  deviceId?: string,
  // How the item's variants change when it has some (`startsVariants`: the window's edits, which
  // may give it its first ones).
  onVariants?: VariantStep,
  startsVariants = false,
) {
  const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, itemId)).for("update");
  if (!item) return null;
  const cats = ctx.cats ?? (await listCategories(tx));
  const cat = getCategory(cats, categoryOf(item, cats));
  const sheet = !!cat?.sheet;
  const before = storedVariants(item.variants);
  // A PC station has none either: its stock is its PCs, and a Defective count would delete them.
  if (onVariants && (before.length || startsVariants) && variantsAllowed(cat) && !item.station) {
    const unc = await uncountedIds(tx);
    const out = onVariants(before, unc, item);
    const list = (Array.isArray(out) ? out : out.variants).map((v) => ({ ...v, count: snapStock(v.count, false) }));
    // The last variant removed: the stock stays as the item's plain stock, in its condition.
    const to = list.length ? countingSum(list, unc) : item.inStock;
    const conditionId = Array.isArray(out) ? item.conditionId : out.conditionId;
    if (item.station) await fitDevices(tx, item.id, to, deviceId, item.station);
    await tx.update(inventoryItems).set({ inStock: to, variants: list, conditionId }).where(eq(inventoryItems.id, item.id));
    // An item's first variants: the stock it had stood as the first of them, in its condition.
    const was = before.length ? before : list.slice(0, 1).map((v) => ({ ...v, conditionId: item.conditionId, count: item.inStock }));
    for (const m of variantMoves(was, list.length ? list : was, unc)) await logMove(tx, item.id, m.delta, m.broke ? "broke" : reason, partId, ctx, m.variantId);
    return { name: item.name, from: item.inStock, to };
  }
  const after = next({ inStock: item.inStock, sheet, pieces: item.pieces, specs: item.specs, name: item.name, category: cat?.id });
  // A fraction item's stock is its pieces' sum (a custom size can be any share), so it isn't snapped.
  const to = sheet ? Math.max(0, after.inStock) : snapStock(after.inStock, sheet);
  if (item.station) await fitDevices(tx, item.id, to, deviceId, item.station);
  const pieces = after.pieces ?? item.pieces;
  if (to !== item.inStock || JSON.stringify(pieces) !== JSON.stringify(item.pieces)) {
    await tx.update(inventoryItems).set({ inStock: to, pieces }).where(eq(inventoryItems.id, item.id));
  }
  if (to !== item.inStock) await logMove(tx, item.id, to - item.inStock, reason, partId, ctx, null);
  return { name: item.name, from: item.inStock, to };
}

async function logMove(tx: Tx, itemId: string, delta: number, reason: StockReason, partId: string | null, ctx: MoveCtx, variantId: string | null) {
  const visit = ctx.via === "ui" ? await currentVisit() : null;
  await tx.insert(inventoryMoves).values({
    itemId,
    delta,
    reason,
    partId,
    memberId: ctx.memberId,
    via: ctx.via,
    aiName: ctx.aiName ?? null,
    batchId: ctx.batchId ?? null,
    visitId: visit?.id,
    page: visit?.page,
    variantId,
  });
}

// A PC station's stock is how many PCs it has (config/stations.ts, Harel 2026-11-20): a new one
// stands in the middle of the station's room on the floor plan; fewer take off `remove` first (a
// PC's own Delete: gone for good, a −1 move in the history), then the newest. Run under the item's
// row lock, so two phones tapping at once can't miss a row.
export async function fitDevices(tx: Tx, itemId: string, count: number, remove?: string, station?: string | null) {
  const rows = await tx.select({ id: inventoryDevices.id, position: inventoryDevices.position }).from(inventoryDevices).where(eq(inventoryDevices.itemId, itemId)).orderBy(desc(inventoryDevices.position), desc(inventoryDevices.createdAt));
  if (rows.length < count) {
    const top = rows[0]?.position ?? -1;
    const [x, y] = stationRoom(station)?.centre ?? [0.5, 0.5];
    await tx.insert(inventoryDevices).values(Array.from({ length: count - rows.length }, (_, i) => ({ itemId, position: top + 1 + i, x, y })));
  } else if (rows.length > count) {
    const first = rows.filter((r) => r.id === remove);
    const gone = [...first, ...rows.filter((r) => r.id !== remove)].slice(0, rows.length - count).map((r) => r.id);
    await tx.delete(inventoryDevices).where(inArray(inventoryDevices.id, gone));
  }
}

// Set the stock to a counted amount (the item form, a stocktake). Worked out on the locked row,
// the way the page shows it (countPieces): a + that lands meanwhile can't be lost, and a sheet
// item keeps the amount typed rather than stepping one piece of it.
// `variantId`: count just that variant of an item with variants; without one the difference
// lands on its first counting variant.
export async function setStock(tx: Tx, itemId: string, amount: number, ctx: MoveCtx, variantId?: string | null) {
  return changeStock(tx, itemId, (item) => countPieces(item, amount), "counted", null, ctx, undefined, (v, unc) => countVariants(v, snapStock(amount, false), unc, variantId, randomUUID));
}

// Reverse a batch's stock changes (undo_batch, Undo, Revert), as new moves in a new batch.
// `only` picks some of them (the parts whose status an undo put back).
export async function undoMoves(tx: Tx, batchId: string | string[], ctx: MoveCtx, only?: (move: typeof inventoryMoves.$inferSelect) => boolean) {
  const ids = typeof batchId === "string" ? [batchId] : batchId;
  if (!ids.length) return 0;
  const rows = (await tx.select().from(inventoryMoves).where(inArray(inventoryMoves.batchId, ids)).orderBy(asc(inventoryMoves.at))).filter((r) => !only || only(r));
  for (const r of rows) await moveStock(tx, { itemId: r.itemId, delta: -r.delta, reason: "counted", partId: r.partId, variantId: r.variantId }, ctx);
  return rows.length;
}
