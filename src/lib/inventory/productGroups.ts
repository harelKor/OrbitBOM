// Product search results grouped Google-style: the same product from several stores is one row
// with a choice of store (and price) under it.

export type Offer = { vendor: string; url: string; title: string; image: string | null; price: number | null; sku?: string | null };
export type ProductGroup = { title: string; image: string | null; offers: Offer[] };

const STOP = new Set(["the", "and", "for", "with", "of", "a", "pack", "pk", "new"]);
const words = (title: string, vendor: string) => {
  const v = new Set(vendor.toLowerCase().split(/[^a-z0-9]+/));
  return new Set(
    title
      .toLowerCase()
      .replace(/(\d)\s*(t|mm|in)\b/g, "$1$2")
      .split(/[^a-z0-9/.#]+/)
      .filter((w) => w && !STOP.has(w) && !v.has(w)),
  );
};

function similar(a: Set<string>, b: Set<string>) {
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  const either = a.size + b.size - both;
  return either ? both / either : 0;
}

export function groupOffers(offers: Offer[], threshold = 0.7): ProductGroup[] {
  const groups: { keys: Set<string>; skus: Set<string>; offers: Offer[] }[] = [];
  for (const o of offers) {
    const keys = words(o.title, o.vendor);
    const sku = o.sku?.trim().toLowerCase();
    const g = groups.find((g) => !g.offers.some((x) => x.vendor === o.vendor) && ((sku && g.skus.has(sku)) || similar(g.keys, keys) >= threshold));
    if (g) {
      g.offers.push(o);
      if (sku) g.skus.add(sku);
    } else groups.push({ keys, skus: new Set(sku ? [sku] : []), offers: [o] });
  }
  return groups.map((g) => {
    const sorted = [...g.offers].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    return { title: g.offers[0].title, image: g.offers.find((o) => o.image)?.image ?? null, offers: sorted };
  });
}
