// Shopify stores (AndyMark, WCP, ThriftyBot...) answer <product-url>.json with every variant (bore,
// size, durometer) and the pictures tied to each. A family page like AndyMark's Compliant Wheels
// holds 43 variants, so a link or search that names a color, durometer or bore is narrowed to the
// one variant: its own ?variant= link, picture, price and title (Harel, 2026-10-30). Plain text
// work, so it is tested on its own.

export type ShopifyVariant = {
  id: number;
  title: string;
  sku?: string | null;
  price?: string | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
  featured_image?: { src?: string } | null;
  image_id?: number | null;
};
export type ShopifyImage = { id: number; src: string; alt?: string | null; variant_ids?: number[] };
export type ShopifyProduct = { title: string; handle: string; variants: ShopifyVariant[]; images: ShopifyImage[]; image?: ShopifyImage | null };

const COLORS = ["black", "blue", "gray", "green", "orange", "red", "yellow", "white", "purple", "clear"];

// "1/2\" Hex", "1/2 in Hex", "0.5in hex" all read "1/2 hex"; 2" and "2 inch" read "2in".
const FRACTIONS: Record<string, string> = { "0.5": "1/2", "0.375": "3/8", "0.25": "1/4", "0.75": "3/4", "1.125": "1 1/8" };
export function variantTokens(text: string): Set<string> {
  let t = ` ${text.toLowerCase()} `
    .replace(/[″”“]/g, '"')
    .replace(/\bgrey\b/g, "gray")
    .replace(/\bblk\b/g, "black")
    .replace(/(?<![\d/.])(\d+(?:\.\d+|\/\d+)?)\s*(?:"|in\b|inch\b|inches\b)/g, (_, n: string) => ` ${FRACTIONS[n] ?? n}in `)
    .replace(/(\d+)\s+(\d+\/\d+)in\b/g, "$1-$2in")
    .replace(/(\d+)\.25in\b/g, "$1-1/4in")
    .replace(/(\d+)\.5in\b/g, "$1-1/2in")
    .replace(/(\d+)\.75in\b/g, "$1-3/4in");
  const out = new Set<string>();
  for (const m of t.matchAll(/\b(\d{2})\s?a\b/g)) out.add(`${m[1]}a`);
  for (const c of COLORS) if (new RegExp(`(^|[^a-z])${c}([^a-z]|$)`).test(t)) out.add(c);
  // A bore: a size followed by hex or round ("1/2in hex", "5 mm hex", "nub bore").
  for (const m of t.matchAll(/(\d+(?:[-/.]\d+)*(?:\/\d+)?)(in|\s?mm)?\s+(hex|round)/g)) out.add(`${m[1]}${m[2]?.trim() === "mm" ? "mm" : ""} ${m[3]}`);
  if (/\bnub\b/.test(t)) out.add("nub");
  t = t.replace(/(\d+(?:[-/.]\d+)*(?:\/\d+)?)(in|\s?mm)?\s+(hex|round)/g, " ");
  for (const m of t.matchAll(/(\d+(?:-\d+\/\d+|\/\d+|\.\d+)?)in\b/g)) out.add(`${m[1]}in`);
  return out;
}

// What a variant is: its options, its SKU (AndyMark's "am-3462_blue" carries the color) and the
// alt text of its picture ("Diameter=2 inch, Durometer=50A, Bore=1/2 in Hex").
function describe(p: ShopifyProduct, v: ShopifyVariant) {
  const img = variantImage(p, v);
  return variantTokens([v.title, v.option1, v.option2, v.option3, (v.sku ?? "").replace(/[_-]/g, " "), img?.alt ?? ""].filter(Boolean).join(" / "));
}

export function variantImage(p: ShopifyProduct, v: ShopifyVariant): ShopifyImage | null {
  if (v.featured_image?.src) return p.images.find((i) => i.src === v.featured_image!.src) ?? { id: 0, src: v.featured_image.src };
  return (
    p.images.find((i) => i.id === v.image_id) ??
    p.images.find((i) => i.variant_ids?.includes(v.id)) ??
    // AndyMark leaves a few pictures untied; their alt text still names the SKU.
    (v.sku ? p.images.find((i) => i.alt?.toLowerCase().includes(` ${v.sku!.toLowerCase()} `)) : undefined) ??
    null
  );
}

// The variant a link or a wanted item names: ?variant=<id>, else the one sharing the most of the
// item's colors, durometers, bores and sizes. A wanted size or durometer the variant lacks rules it
// out, so a 3" item never lands on the 2" wheel. Null when nothing fits or two fit equally well.
export function pickVariant(p: ShopifyProduct, opts: { variantId?: string | null; want?: string | null }): ShopifyVariant | null {
  if (opts.variantId) {
    const v = p.variants.find((x) => String(x.id) === opts.variantId);
    if (v) return v;
  }
  if (p.variants.length === 1) return p.variants[0].title === "Default Title" ? null : p.variants[0];
  const want = variantTokens(opts.want ?? "");
  if (!want.size) return null;
  let best: ShopifyVariant | null = null;
  let bestScore = 0;
  let tie = false;
  for (const v of p.variants) {
    const has = describe(p, v);
    const kinds = (t: string) => (/^\d+a$/.test(t) ? "duro" : COLORS.includes(t) ? "color" : /(hex|round)$|^nub$/.test(t) ? "bore" : "size");
    // Every kind the variant states and the item wants must agree (one of the item's sizes is
    // enough: a 2" wheel 1" wide still fits a "2 inch" variant).
    const clash = ["duro", "color", "bore", "size"].some((k) => {
      const w = [...want].filter((t) => kinds(t) === k);
      const h = [...has].filter((t) => kinds(t) === k);
      return w.length > 0 && h.length > 0 && !w.some((t) => h.includes(t));
    });
    if (clash) continue;
    const score = [...want].filter((w) => has.has(w)).length;
    if (score > bestScore) {
      best = v;
      bestScore = score;
      tie = false;
    } else if (score === bestScore && score > 0) tie = true;
  }
  return tie ? null : best;
}

export function variantTitle(p: ShopifyProduct, v: ShopifyVariant | null) {
  return v && v.title !== "Default Title" ? `${p.title} (${v.title})` : p.title;
}
