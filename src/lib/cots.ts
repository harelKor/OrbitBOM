// COTS parts on the COTS page: which filter box a part belongs in, the same part across a robot's
// systems shown as one card, and prices.

import { guessCategory } from "@/config/inventory";
import { fanOutChanges } from "@/lib/merges/merge";
import type { PartChanges } from "@/lib/parts/changes";

type Named = { displayName: string | null; onshapeName: string | null; material: string | null; cotsCategory: string | null };

// The part's filter box, one of the inventory categories (Harel, 2026-10-27): its linked item's,
// else the one set on it, else a guess from its name and material, else Other.
export function cotsCategoryOf(part: Named, categoryIds: string[], itemCategory?: string | null): string {
  if (itemCategory && categoryIds.includes(itemCategory)) return itemCategory;
  if (part.cotsCategory && categoryIds.includes(part.cotsCategory)) return part.cotsCategory;
  const text = [part.displayName, part.onshapeName, part.material].filter(Boolean).join(" ");
  return guessCategory(text, categoryIds) ?? (categoryIds.includes("other") ? "other" : (categoryIds.at(-1) ?? "other"));
}

type Identity = Named & {
  id: string;
  sourceDid?: string | null;
  sourceEid?: string | null;
  onshapePartId?: string | null;
  orderMerge?: string | null;
};

// The same COTS part in different systems: the same Onshape part (one library part inserted in
// several places) or the same name. Each group keeps the order the parts came in.
export function groupSameCots<T extends Identity>(parts: T[]): T[][] {
  const parent = parts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const firstWith = new Map<string, number>();
  parts.forEach((p, i) => {
    const name = (p.displayName ?? p.onshapeName ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const keys = [
      // Merged on Released into one order line (Harel, 2026-11-20).
      p.orderMerge ? `merge:${p.orderMerge}` : null,
      p.sourceDid && p.sourceEid && p.onshapePartId ? `os:${p.sourceDid}:${p.sourceEid}:${p.onshapePartId}` : null,
      name ? `name:${name}` : null,
    ];
    for (const key of keys) {
      if (!key) continue;
      const j = firstWith.get(key);
      if (j === undefined) firstWith.set(key, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, T[]>();
  parts.forEach((p, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), p]));
  return [...groups.values()];
}

// An edit of a grouped card, per member: the stock count is spread over the members up to each
// one's quantity, a rename reaches every member, and the rest is the same for all.
export function spreadCotsChanges(members: { id: string; quantity: number }[], changes: PartChanges) {
  const { perMember } = fanOutChanges(members, changes);
  if (changes.displayName === undefined) return perMember;
  return members.map((m) => ({ id: m.id, changes: { ...perMember.find((pm) => pm.id === m.id)?.changes, displayName: changes.displayName } }));
}

// What a part costs: the average price of one at the quantity needed, times the quantity.
export const cotsTotal = (p: { unitPrice: number | null; quantity: number }) => (p.unitPrice == null ? null : p.unitPrice * Math.max(p.quantity, 1));

// A link's label: the site's name, else its host.
export function siteOf(link: { url: string; site?: string }) {
  if (link.site) return link.site;
  try {
    return new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    return link.url;
  }
}

// The name an order line shows on Released and the Order List (Harel, 2026-11-20): the one given
// there, else its linked inventory item's, else the part's own.
export const orderTitle = (p: { orderName?: string | null; displayName: string | null; onshapeName: string | null; shelf?: { itemName: string } | null }) =>
  p.orderName ?? p.shelf?.itemName ?? p.displayName ?? p.onshapeName ?? "Unnamed part";

// The part's own BOM name, to go back to from a name given on the order pages.
export const bomTitle = (p: { displayName: string | null; onshapeName: string | null }) => p.displayName ?? p.onshapeName ?? "Unnamed part";

// Released's Merge only joins parts of one inventory item (or none).
export const MERGE_ITEMS_DIFFER = "These parts are linked to different inventory items, so they can't be one order.";
export const sameItemForMerge = (parts: { inventoryItemId: string | null }[]) => new Set(parts.map((p) => p.inventoryItemId).filter(Boolean)).size <= 1;

// ---------- The amount to order (Harel, 2026-11-24) ----------

// What the shelf still misses of a need, in whole units (sheets round up to whole sheets).
export const shortOf = (need: number, inStock: number) => {
  const gap = need - inStock;
  return gap > 1e-9 ? Math.ceil(gap - 1e-9) : 0;
};

type Amountable = {
  orderQty?: number | null;
  restock?: boolean;
  quantity: number;
  stockCount: number;
  shelf?: { sheet: boolean; covered: number; inStock: number; total: number; newShort?: number } | null;
};

// How many to order for one card: the amount a member typed on the order pages, else for a card
// Inventory sent (restock), what its item still misses of its whole need right now (the bigger of
// Needed for Season and the robots', or what it misses of its New season need when that's more),
// so changing the season need changes it; else the part's
// quantity less what the shelf (or its own count) covers. The vendor cart, Copy list, the item
// window's Ordering and receiving into stock all read this.
export function orderAmount(p: Amountable): number {
  if (p.orderQty != null) return p.orderQty;
  const s = p.shelf;
  if (p.restock && s) return Math.max(shortOf(s.total, s.inStock), s.newShort ?? 0);
  return Math.max(0, p.quantity - (s && !s.sheet ? s.covered : p.stockCount));
}

// A price for the amount being ordered (one's price while nothing is left to order).
export const orderTotal = (p: { unitPrice: number | null }, amount: number) => (p.unitPrice == null ? null : p.unitPrice * Math.max(amount, 1));

// ---------- Stock sizes in order names (Harel, 2026-11-24) ----------

// The Raw Stock categories whose pieces have a size worth naming when ordering (plates, tubes, box
// tubes, shafts); filament and blocks don't (config/rawStock.ts NOT_LAID_OUT).
const SIZED = new Set(["aluminum-plates", "polycarbonate", "wood-composites", "square-tubes", "round-tubes", "shafts"]);

const SIZE_RE = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i;
const LENGTH_RE = /(\d+(?:\.\d+)?)/;

// A raw-stock item's piece size: "900×500" for a plate (X then Y, the bigger side first, as
// Inventory writes sizes since 2026-11-24), "1000 long" for a tube or shaft.
export function stockSize(item: { category: string; specs: Record<string, string>; name: string } | null | undefined): string | null {
  if (!item || !SIZED.has(item.category)) return null;
  const length = LENGTH_RE.exec(item.specs.length ?? "");
  if (length && Number(length[1])) return `${Number(length[1])} long`;
  const s = SIZE_RE.exec(item.specs.size ?? "") ?? SIZE_RE.exec(item.name);
  // A plate's sheet: both sides at least 100 mm, so a tube's "40x20" isn't taken for one.
  if (s && Number(s[1]) >= 100 && Number(s[2]) >= 100) {
    const [x, y] = [Number(s[1]), Number(s[2])].sort((a, b) => b - a);
    return `${x}×${y}`;
  }
  return null;
}

// An order line's name with its stock size, on the order pages only: "10 mm Aluminum plate ·
// 900×500". A name that already says the size (either way round) stays as it is.
export function withStockSize(title: string, size: string | null): string {
  if (!size) return title;
  const flat = (t: string) => t.toLowerCase().replace(/[x×*]/g, "x").replace(/\s+/g, "");
  const bare = size.replace(" long", "");
  const turned = bare.split("×").reverse().join("×");
  return flat(title).includes(flat(bare)) || flat(title).includes(flat(turned)) ? title : `${title} · ${size}`;
}

// Copy list (a cart of parts with no product link): a plain list to paste into WhatsApp or email.
export function copyListText(title: string, lines: { name: string; amount: number }[]): string {
  return [title, ...lines.map((l) => `${l.amount} × ${l.name}`)].join("\n");
}
