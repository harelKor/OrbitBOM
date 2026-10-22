// Inventory allocation: all active robots share one shelf (Harel, 2026-10-22), so an item's need
// is the sum of every linked part's quantity. Stock fills the parts in a fixed order: parts already
// In Stock first (they got their units), then parts being ordered, then the rest, each group in
// the order the parts came in. Computed on read, never stored, so counts can't drift.
// Sheet items (plates) list the parts that use them, but a part's share of a sheet isn't known, so
// they have no need and nothing is ever short.

import { COTS_IN_STOCK, ORDER_STATUSES } from "@/config/cots";

export type UsagePart = {
  partId: string;
  inventoryItemId: string;
  quantity: number;
  robotId: string;
  robotName: string;
  systemId?: string;
  systemName: string;
  partName: string;
  status?: string;
};

export type RobotAllocation = { robotId: string; robotName: string; needed: number; allocated: number };

export type ItemUsage = {
  parts: UsagePart[];
  robots: RobotAllocation[];
  need: number; // units every active robot's parts need together (0 for a sheet item)
  covered: number; // how many of those the stock covers
  short: number; // need − covered
  free: number; // stock no part needs
  coveredOf: Map<string, number>; // per part
};

const rank = (status?: string) => (status === COTS_IN_STOCK ? 0 : status && (ORDER_STATUSES as string[]).includes(status) ? 1 : 2);

export function computeUsage(stock: Map<string, number>, parts: UsagePart[], sheetItems: Set<string> = new Set()): Map<string, ItemUsage> {
  const byItem = new Map<string, UsagePart[]>();
  for (const part of parts) byItem.set(part.inventoryItemId, [...(byItem.get(part.inventoryItemId) ?? []), part]);
  const result = new Map<string, ItemUsage>();
  for (const [itemId, itemParts] of byItem) {
    const inStock = stock.get(itemId) ?? 0;
    const sheet = sheetItems.has(itemId);
    const ordered = itemParts.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p.status) - rank(b.p.status) || a.i - b.i);
    const coveredOf = sheet ? new Map<string, number>() : allocateToParts(inStock, ordered.map(({ p }) => p));
    const robots: RobotAllocation[] = [];
    for (const part of itemParts) {
      let robot = robots.find((r) => r.robotId === part.robotId);
      if (!robot) robots.push((robot = { robotId: part.robotId, robotName: part.robotName, needed: 0, allocated: 0 }));
      if (sheet) continue;
      robot.needed += part.quantity;
      robot.allocated += coveredOf.get(part.partId) ?? 0;
    }
    const need = sheet ? 0 : itemParts.reduce((n, p) => n + p.quantity, 0);
    const covered = Math.min(need, inStock);
    result.set(itemId, { parts: itemParts, robots, need, covered, short: need - covered, free: Math.max(0, inStock - need), coveredOf });
  }
  return result;
}

// How many of a part's units the stock covers, filling the parts in order.
export function allocateToParts(inStock: number, parts: { partId: string; quantity: number }[]) {
  let left = Math.floor(inStock);
  const out = new Map<string, number>();
  for (const p of parts) {
    const take = Math.min(p.quantity, Math.max(left, 0));
    left -= take;
    out.set(p.partId, (out.get(p.partId) ?? 0) + take);
  }
  return out;
}
