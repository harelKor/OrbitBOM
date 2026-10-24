import "server-only";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { COTS_IN_STOCK, ORDER_STATUSES, cotsStatusOf } from "@/config/cots";
import { usageOf } from "@/lib/data/inventory";
import { isFabFinished } from "@/lib/fab";
import { fillCardFromItem, pushCardToItem } from "@/lib/inventory/cotsSync";
import { normName, onshapeKeyOf } from "@/lib/inventory/match";
import { moveStock } from "@/lib/inventory/moves";
import { computeStatus } from "@/lib/status";
import { currentVisit } from "@/lib/visits";
import { planPartUpdate, type PartChanges, type Plan } from "./changes";

const { parts, partHistory, inventoryItems } = schema;
const ORDERING = ORDER_STATUSES.filter((s) => s !== COTS_IN_STOCK) as string[];

const inStockNow = (p: typeof parts.$inferSelect) => p.classification === "cots" && computeStatus(p) === COTS_IN_STOCK;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Ctx = {
  memberId: string | null;
  via: "ui" | "sync" | "mcp";
  batchId?: string; // to know the batch before it runs; a new one by default
  // false when the caller already moved the stock itself (the COTS card's − / +).
  receive?: boolean;
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
  const batchId = ctx.batchId ?? randomUUID();
  if (!edits.length) return { batchId, changed: 0 };
  const byId = new Map(edits.map((e) => [e.id, e.changes]));
  // Changes made from a page belong to that page visit (Recent actions on the dashboard).
  const visit = ctx.via === "ui" ? await currentVisit() : null;

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(parts).where(inArray(parts.id, [...byId.keys()])).for("update");
    let changed = 0;
    for (const row of rows) {
      const plan = planPartUpdate(row, byId.get(row.id)!, ctx.via);
      const { set, history } = plan;
      if (!history.length) continue;
      changed++;
      // An order arrived: a linked COTS part going from the Order List to In Stock adds what the
      // shelf was missing for it to its item's stock.
      const after = { ...row, ...set };
      let received = 0;
      if (
        ctx.receive !== false &&
        after.classification === "cots" &&
        after.inventoryItemId &&
        set.designState === COTS_IN_STOCK &&
        ORDERING.includes(cotsStatusOf(row.designState))
      ) {
        const { usage } = await usageOf([after.inventoryItemId], tx);
        received = Math.max(0, after.quantity - (usage.get(after.inventoryItemId)?.coveredOf.get(row.id) ?? 0));
      }
      await tx
        .update(parts)
        .set({
          ...set,
          // Made parts carry when they were finished; a part sent back to work loses it.
          fabFinishedAt: isFabFinished({ ...row, ...set }) ? (row.fabFinishedAt ?? new Date()) : null,
          // A COTS part keeps when it arrived while it stays In Stock; leaving In Stock un-clears it.
          ...(inStockNow(after) ? { cotsInStockAt: row.cotsInStockAt ?? new Date() } : { cotsInStockAt: null, cotsClearedAt: null }),
          lastModifiedAt: new Date(),
          lastModifiedBy: ctx.memberId,
        })
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
          visitId: visit?.id,
          page: visit?.page,
        })),
      );
      if (received) await moveStock(tx, { itemId: after.inventoryItemId!, delta: received, reason: "received", partId: row.id }, { memberId: ctx.memberId, via: ctx.via, batchId });
      if (set.inventoryItemId) {
        await rememberLink(tx, set.inventoryItemId, row);
        await fillCardFromItem(tx, after, set.inventoryItemId);
      }
      // Onshape sync doesn't touch the COTS fields; an edit by a member or AI reaches the item.
      if (ctx.via !== "sync") await pushCardToItem(tx, row, after, { memberId: ctx.memberId, via: ctx.via, batchId });
      await ctx.afterEach?.(tx, row, plan);
    }
    return { batchId, changed };
  });
}

// A part was linked to an item: the item remembers the part's Onshape library part (new BOM parts
// with it are linked on sync) and its name, for later match suggestions.
async function rememberLink(tx: Tx, itemId: string, part: typeof parts.$inferSelect) {
  const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, itemId));
  if (!item) return;
  const key = onshapeKeyOf(part);
  const name = part.displayName ?? part.onshapeName;
  const known = [item.name, ...item.aliases].map(normName);
  const aliases = name && !known.includes(normName(name)) ? [...item.aliases, name].slice(-20) : item.aliases;
  if ((item.onshapeKey || !key) && aliases === item.aliases) return;
  await tx.update(inventoryItems).set({ onshapeKey: item.onshapeKey ?? key, aliases }).where(eq(inventoryItems.id, itemId));
}
