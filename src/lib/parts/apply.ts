import "server-only";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { COTS_IN_STOCK, ORDER_STATUSES, cotsStatusOf } from "@/config/cots";
import { usageOf } from "@/lib/data/inventory";
import { isAreaInStock, isFabFinished } from "@/lib/fab";
import { arrives } from "@/lib/seen";
import { fillCardFromItem, pushCardToItem } from "@/lib/inventory/cotsSync";
import { normName, onshapeKeyOf } from "@/lib/inventory/match";
import { moveStock } from "@/lib/inventory/moves";
import { isBought, orderStatus } from "@/lib/status";
import { isReleaseMove, lockRelease } from "@/lib/versions/release";
import { currentVisit } from "@/lib/visits";
import { planPartUpdate, type PartChanges, type Plan } from "./changes";
import { recordOrderHistory } from "./orderHistory";

const { parts, partHistory, inventoryItems, inventoryCategories } = schema;
const ORDERING = ORDER_STATUSES.filter((s) => s !== COTS_IN_STOCK) as string[];

// In Stock on the COTS page (a part bought as its Process 1 too, Harel 2026-11-20).
const inStockNow = (p: typeof parts.$inferSelect) => isBought(p) && orderStatus(p) === COTS_IN_STOCK;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Ctx = {
  memberId: string | null;
  via: "ui" | "sync" | "mcp";
  batchId?: string; // to know the batch before it runs; a new one by default
  // false when the caller already moved the stock itself (the COTS card's − / +).
  receive?: boolean;
  // Runs in the same transaction for each part that changed (To Review records its rows here).
  afterEach?: (tx: Tx, row: typeof parts.$inferSelect, plan: Plan) => Promise<void>;
  // Leaves a part alone unless its locked, current row passes (a change meant for a status it had).
  onlyIf?: (row: typeof parts.$inferSelect) => boolean;
  // The caller's transaction, so its own writes and these changes save or fail together.
  tx?: Tx;
  // Plans each locked row instead of planPartUpdate (undo writes stored values back as they were,
  // without the status rules), so the side effects below still follow the change.
  plan?: (row: typeof parts.$inferSelect) => Plan;
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
  const fromItem = ctx.via === "sync" ? new Map<string, PartChanges>() : await linkedItemSetup(edits.map((e) => e.changes));
  // Changes made from a page belong to that page visit (Recent actions on the dashboard).
  const visit = ctx.via === "ui" ? await currentVisit() : null;

  const run = async (tx: Tx) => {
    // Locked in id order, so two bulk edits over the same parts wait for each other instead of deadlocking.
    const rows = await tx.select().from(parts).where(inArray(parts.id, [...byId.keys()])).orderBy(asc(parts.id)).for("update");
    let changed = 0;
    // A plain edit (a made part, nothing linked, no release) touches only its own row and its
    // history: those wait here and go out together, a few queries for a whole bulk edit instead of
    // two per part. Anything else first sends what's waiting, so it reads the parts as before.
    const now = new Date();
    const waiting = new Map<string, { values: Partial<typeof parts.$inferInsert>; ids: string[] }>();
    const waitingHistory: (typeof partHistory.$inferInsert)[] = [];
    const flush = async () => {
      for (const { values, ids } of waiting.values()) await tx.update(parts).set(values).where(inArray(parts.id, ids));
      waiting.clear();
      for (let i = 0; i < waitingHistory.length; i += 1000) await tx.insert(partHistory).values(waitingHistory.slice(i, i + 1000));
      waitingHistory.length = 0;
    };
    for (const row of rows) {
      if (ctx.onlyIf && !ctx.onlyIf(row)) continue;
      const own = byId.get(row.id)!;
      // Linking an item sets the part's type from the item's group; what the edit says itself wins.
      const extra = own.inventoryItemId && row.classification !== "external" ? fromItem.get(own.inventoryItemId) : undefined;
      const plan = ctx.plan ? ctx.plan(row) : planPartUpdate(row, extra ? { ...extra, ...own } : own, ctx.via);
      const { set, history } = plan;
      if (!history.length) continue;
      changed++;
      // An order arrived: a linked COTS part going from the Order List to In Stock adds what the
      // shelf was missing for it to its item's stock (nothing when the shelf already had it).
      const after = { ...row, ...set };
      const plain = !ctx.afterEach && !isBought(row) && !isBought(after) && !set.inventoryItemId && !isReleaseMove(row, after);
      if (!plain) await flush(); // what follows may read other parts (the shelf's count below)
      let received = 0;
      if (
        ctx.receive !== false &&
        !own.fromShelfPrompt &&
        after.classification === "cots" &&
        after.inventoryItemId &&
        set.designState === COTS_IN_STOCK &&
        ORDERING.includes(cotsStatusOf(row.designState))
      ) {
        const { usage, items } = await usageOf([after.inventoryItemId], tx);
        if (after.restock) {
          // A card Inventory sent to refill the shelf: what the item still misses of its whole need
          // (the bigger of its season count and the robots'), up to the card's quantity.
          const item = items[0];
          const total = Math.max(item?.seasonNeed ?? 0, usage.get(after.inventoryItemId)?.need ?? 0);
          received = item ? Math.min(after.quantity, Math.max(0, Math.ceil(total - item.inStock - 1e-9))) : 0;
        } else received = Math.max(0, after.quantity - (usage.get(after.inventoryItemId)?.coveredOf.get(row.id) ?? 0));
      }
      const values = {
        ...set,
        // Made parts carry when they were finished (a factory's or printer's part: when it reached In Stock);
        // a part sent back to work loses it.
        fabFinishedAt: isFabFinished({ ...row, ...set }) || isAreaInStock({ ...row, ...set }) ? (row.fabFinishedAt ?? now) : null,
        // A COTS part keeps when it arrived while it stays In Stock; leaving In Stock un-clears it.
        ...(inStockNow(after) ? { cotsInStockAt: row.cotsInStockAt ?? now } : { cotsInStockAt: null, cotsClearedAt: null }),
        // Arriving in a page's list (Released, In process, the Order List...) makes it glow there
        // for members who haven't opened that page since (src/lib/seen.ts).
        ...(arrives(row, after) && { stageAt: now }),
        lastModifiedAt: now,
        lastModifiedBy: ctx.memberId,
      };
      const historyRows = history.map((h) => ({
        partId: row.id,
        field: h.field,
        oldValue: h.oldValue,
        newValue: h.newValue,
        memberId: ctx.memberId,
        via: ctx.via,
        batchId,
        visitId: visit?.id,
        page: visit?.page,
      }));
      if (plain) {
        // Parts given the very same values share one update.
        const key = JSON.stringify(values);
        const group = waiting.get(key);
        if (group) group.ids.push(row.id);
        else waiting.set(key, { values, ids: [row.id] });
        waitingHistory.push(...historyRows);
        continue;
      }
      await tx.update(parts).set(values).where(eq(parts.id, row.id));
      await tx.insert(partHistory).values(historyRows);
      // A COTS order went In Route, arrived, or was taken back: its Order History card follows.
      if (set.designState !== undefined && !own.fromShelfPrompt) await recordOrderHistory(tx, row, after);
      // Sent to fab: To Fab keeps this state until the part is released again (plan/fab-version-lock.md).
      if (isReleaseMove(row, after)) await lockRelease(tx, after, { memberId: ctx.memberId, batchId });
      if (received) await moveStock(tx, { itemId: after.inventoryItemId!, delta: received, reason: "received", partId: row.id }, { memberId: ctx.memberId, via: ctx.via, batchId });
      if (set.inventoryItemId) {
        // A made part's material item (a plate it's cut from) isn't the part: only COTS links teach
        // the item a name and an Onshape part.
        if (after.classification === "cots") await rememberLink(tx, set.inventoryItemId, row);
        await fillCardFromItem(tx, after, set.inventoryItemId);
      }
      // Onshape sync doesn't touch the COTS fields; an edit by a member or AI reaches the item.
      if (ctx.via !== "sync") await pushCardToItem(tx, row, after, { memberId: ctx.memberId, via: ctx.via, batchId });
      await ctx.afterEach?.(tx, row, plan);
    }
    await flush();
    return { batchId, changed };
  };
  return ctx.tx ? run(ctx.tx) : db.transaction(run);
}

// What linking a part to each item in these edits sets besides the link (Harel, 2026-10-31): a Raw
// Stock item is a material, so the part is made in-house from it; a COTS, Hardware or Electrical
// item is the part itself, so the part is COTS of that category. Edits that set the type
// themselves are left alone.
async function linkedItemSetup(changes: PartChanges[]): Promise<Map<string, PartChanges>> {
  const ids = [...new Set(changes.filter((c) => c.inventoryItemId && c.classification === undefined).map((c) => c.inventoryItemId!))];
  const out = new Map<string, PartChanges>();
  if (!ids.length) return out;
  const items = await db
    .select({ id: inventoryItems.id, name: inventoryItems.name, category: inventoryItems.category, group: inventoryCategories.group })
    .from(inventoryItems)
    .leftJoin(inventoryCategories, eq(inventoryCategories.id, inventoryItems.category))
    .where(inArray(inventoryItems.id, ids));
  for (const i of items) {
    if (i.group === "consumables") out.set(i.id, { classification: "inhouse", material: i.name });
    else if (i.group === "cots" || i.group === "hardware" || i.group === "electrical") out.set(i.id, { classification: "cots", cotsCategory: i.category });
  }
  return out;
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
