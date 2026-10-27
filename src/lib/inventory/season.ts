// What an item still needs (Harel, 2026-10-27). Two separate needs: the season's (a number set on
// the item, whatever the robots use) and the robots' (their linked parts, from computeUsage). They
// are never added together; outside the Short views the bigger one counts.
// An "open order" is a COTS card for the item that's on its way: one sent from Inventory or added
// on the COTS page (no system) in Released, or any linked card on the Order List.

import { COTS_RELEASED, ORDER_STATUSES, COTS_IN_STOCK } from "@/config/cots";

export type NeedView = "season" | "robots" | "any";
export type Standing = "short" | "ordered" | "ok";
export type OpenOrder = { partId: string; status: string };

type Needs = { inStock: number; seasonNeed: number | null; sheet: boolean; usage: { need: number } | null; openOrder: OpenOrder | null };

const ORDERING = ORDER_STATUSES.filter((s) => s !== COTS_IN_STOCK) as string[];

export const hasSeasonNeed = (i: Pick<Needs, "seasonNeed">) => (i.seasonNeed ?? 0) > 0;
export const usedByRobots = (i: { usage: { parts: unknown[] } | null }) => (i.usage?.parts.length ?? 0) > 0;

// Y in the card's "X / Y": the view's need; null when nothing is needed.
export function neededFor(i: Needs, view: NeedView): number | null {
  const season = hasSeasonNeed(i) ? i.seasonNeed! : 0;
  const robots = i.usage?.need ?? 0;
  const y = view === "season" ? season : view === "robots" ? robots : Math.max(season, robots);
  return y > 0 ? y : null;
}

// How many more the shelf needs for that view. Sheets round up to whole sheets.
export function missing(i: Needs, view: NeedView): number {
  const y = neededFor(i, view);
  if (y == null) return 0;
  const gap = y - i.inStock;
  return gap > 1e-9 ? (i.sheet ? Math.ceil(gap - 1e-9) : Math.ceil(gap)) : 0;
}

// The card's colour in the Short views: red short, orange on order, green covered.
export function standing(i: Needs, view: NeedView): Standing {
  if (i.openOrder) return "ordered";
  return missing(i, view) > 0 ? "short" : "ok";
}

// Whether a linked COTS card counts as an open order, and the newest of an item's cards.
export const isOpenOrder = (p: { status: string; systemId: string | null; restock: boolean }) =>
  ORDERING.includes(p.status) || (p.status === COTS_RELEASED && (p.systemId === null || p.restock));

export function newestOpenOrders<T extends { itemId: string; partId: string; status: string; systemId: string | null; restock: boolean; at: Date }>(rows: T[]) {
  const out = new Map<string, OpenOrder>();
  const sorted = rows.filter(isOpenOrder).sort((a, b) => +b.at - +a.at);
  for (const r of sorted) if (!out.has(r.itemId)) out.set(r.itemId, { partId: r.partId, status: r.status });
  return out;
}

// The COTS page that shows an open order's card.
export const orderHref = (o: OpenOrder) => `/cots/${o.status === COTS_RELEASED ? "released" : "order-list"}?part=${o.partId}`;
