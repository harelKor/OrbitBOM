// Is the scanned part already on the shelf? Then the scan opens that item instead of a new one
// (Harel, 2026-11-11). Strongest first: an item linked to the product the stores found, then an
// item named like the product the model read, then an item of the same category with every field
// the scan filled.

import { normName, normUrl } from "@/lib/inventory/match";
import type { Recognized } from "./answer";

export type ShelfItem = { id: string; name: string; category: string; specs: Record<string, string>; cotsLinks: { url: string }[] };

const same = (a: string, b: string | undefined) => !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export function shelfMatches<T extends ShelfItem>(r: Recognized, productUrls: string[], items: T[]): T[] {
  const out: T[] = [];
  const add = (list: T[]) => list.forEach((i) => out.includes(i) || out.push(i));

  // The product page, whatever variant (?variant=) the store's link or the item's link names.
  const page = (url: string) => normUrl(url).replace(/\?.*$/, "");
  const urls = new Set(productUrls.map(page));
  if (urls.size) add(items.filter((i) => i.cotsLinks.some((l) => urls.has(page(l.url)))));

  if (r.name) {
    const brand = new Set(normName(r.brand).split(" "));
    const words = normName(r.name)
      .split(" ")
      .filter((w) => w && !brand.has(w));
    // A real product word: one with a digit (X60, 6802) or a long one (CANcoder).
    if (words.some((w) => /\d/.test(w) || w.length >= 5))
      add(
        items.filter((i) => {
          const have = new Set(normName(i.name).split(" "));
          return words.every((w) => have.has(w));
        }),
      );
  }

  const specs = Object.entries(r.specs);
  if (r.categoryId && specs.length) add(items.filter((i) => i.category === r.categoryId && specs.every(([k, v]) => same(v, i.specs[k]))));
  return out.slice(0, 6);
}
