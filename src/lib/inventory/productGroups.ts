// Product search results grouped Google-style: the same product from several stores is one row
// with a choice of store (and price) under it. Stores name the same product differently
// ("Falcon 500 Brushless Motor", "Falcon 500 Powered by Talon FX"), so titles with the same sizes
// and model numbers join on fewer shared words; different numbers never join (Harel, 2026-11-25).

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

// The words with a digit in them: sizes, tooth counts, model numbers ("8mm", "36t", "x60", "500").
const hasDigit = (w: string) => /\d/.test(w);
const numbersOf = (keys: Set<string>) => [...keys].filter(hasDigit).sort().join(" ");
// A model number ("x60", "500", "3005"), not a size ("8mm", "1/2in", "36t", "2"): it names one product.
const isModel = (w: string) => hasDigit(w) && !/^[\d./]+(mm|cm|in|t|m|lb|oz)$/.test(w) && (/[a-z]/.test(w) || w.replace(/\D/g, "").length >= 3);

// Same numbers, and: with a model number, a word in common; with only sizes, most of the shorter
// title's other words in the longer one ("8mm hex bearing" isn't "8mm hex shaft").
function sameProduct(a: Set<string>, b: Set<string>, threshold: number) {
  if (similar(a, b) >= threshold) return true;
  const n = numbersOf(a);
  if (!n || n !== numbersOf(b)) return false;
  const [short, long] = a.size <= b.size ? [a, b] : [b, a];
  const plain = [...short].filter((w) => !hasDigit(w));
  const shared = plain.filter((w) => long.has(w)).length;
  if ([...short].some(isModel)) return shared > 0 || !plain.length;
  return plain.length > 0 && shared / plain.length >= 0.75;
}

export function groupOffers(offers: Offer[], threshold = 0.7): ProductGroup[] {
  const groups: { keys: Set<string>; skus: Set<string>; offers: Offer[] }[] = [];
  for (const o of offers) {
    const keys = words(o.title, o.vendor);
    const sku = o.sku?.trim().toLowerCase();
    const g = groups.find((g) => !g.offers.some((x) => x.vendor === o.vendor) && ((sku && g.skus.has(sku)) || sameProduct(g.keys, keys, threshold)));
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
