import "server-only";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { db } from "@/db";
import { schema } from "@/db";
import { cotsStatusOf } from "@/config/cots";
import { siteOf } from "@/lib/cots";
import { isBought, orderStatus } from "@/lib/status";

// The COTS Order History cards (Harel, 2026-11-02). A COTS part's status move records its order:
// going In Route opens a card, reaching Arrived or In Stock dates its arrival. A move undone
// within a day takes the card back; after a day the card stays and the next move starts a new one.
// A part bought as its Process 1 records its order the same way, from its order status (Harel,
// 2026-11-20): it has no inventory item of its own, so its card has none.

const { cotsOrderHistory } = schema;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Part = typeof schema.parts.$inferSelect;

const DAY_MS = 24 * 60 * 60 * 1000;
type Stage = "lower" | "route" | "arrived";

// Arrived is checked by name too, so this works before and after it joins COTS_STATUSES.
function stageOf(part: Part): Stage {
  if (part.classification === "cots" && part.designState === "Arrived") return "arrived";
  const s = part.classification === "cots" ? cotsStatusOf(part.designState) : orderStatus(part);
  if (s === "In Route") return "route";
  if (s === "In Stock" || (s as string) === "Arrived") return "arrived";
  return "lower"; // Not Started, Released, In Order List, Seen
}

const within = (at: Date | null, now: Date) => !!at && now.getTime() - at.getTime() < DAY_MS;

export async function recordOrderHistory(tx: Tx, before: Part, after: Part) {
  if (!isBought(after)) return;
  const from = isBought(before) ? stageOf(before) : "lower";
  const to = stageOf(after);
  if (from === to) return;
  const now = new Date();
  const mine = eq(cotsOrderHistory.partId, after.id);

  // The newest card still waiting to arrive.
  const openCard = async () =>
    (
      await tx
        .select()
        .from(cotsOrderHistory)
        .where(and(mine, isNull(cotsOrderHistory.dismissedAt), isNotNull(cotsOrderHistory.inRouteAt), isNull(cotsOrderHistory.arrivedAt)))
        .orderBy(desc(cotsOrderHistory.inRouteAt))
        .limit(1)
    )[0];

  const card = (inRouteAt: Date | null, arrivedAt: Date | null) => {
    const link = after.cotsLinks[0];
    return {
      // A made part's item is its material, not what was bought.
      inventoryItemId: after.classification === "cots" ? after.inventoryItemId : null,
      partId: after.id,
      name: after.displayName ?? after.onshapeName ?? "Unnamed part",
      quantity: after.quantity,
      unitPrice: after.unitPrice,
      vendor: link ? siteOf(link) : null,
      productUrl: link?.url ?? null,
      inRouteAt,
      arrivedAt,
    };
  };

  if (from === "arrived") {
    // Back from Arrived / In Stock: within a day the arrival is taken back.
    const [last] = await tx
      .select()
      .from(cotsOrderHistory)
      .where(and(mine, isNotNull(cotsOrderHistory.arrivedAt)))
      .orderBy(desc(cotsOrderHistory.arrivedAt))
      .limit(1);
    if (!last || !within(last.arrivedAt, now)) return;
    if (!last.inRouteAt || (to === "lower" && within(last.inRouteAt, now))) {
      await tx.delete(cotsOrderHistory).where(eq(cotsOrderHistory.id, last.id));
    } else {
      await tx.update(cotsOrderHistory).set({ arrivedAt: null }).where(eq(cotsOrderHistory.id, last.id));
    }
    return;
  }

  if (to === "route") {
    // from === "lower": a new order is on its way.
    await tx.insert(cotsOrderHistory).values(card(now, null));
    return;
  }

  if (to === "arrived") {
    const open = await openCard();
    if (open) await tx.update(cotsOrderHistory).set({ arrivedAt: now }).where(eq(cotsOrderHistory.id, open.id));
    else await tx.insert(cotsOrderHistory).values(card(null, now));
    return;
  }

  // from === "route", to === "lower": an order sent by mistake goes away within a day.
  const open = await openCard();
  if (open && within(open.inRouteAt, now)) await tx.delete(cotsOrderHistory).where(eq(cotsOrderHistory.id, open.id));
}
