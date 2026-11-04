// An Order List cart's link: the vendor's own cart page with the cart's parts already in it
// (Harel, 2026-11-04). Shopify stores (WCP, AndyMark, ThriftyBot, SDS, CTRE...) take a cart
// permalink, /cart/<variant>:<qty>,<variant>:<qty>; Amazon takes its add-to-cart form's address
// with each ASIN and quantity. Other stores have no link that fills a cart. Plain text work, so
// it is tested on its own; finding a Shopify link's variant is in lib/inventory/product.ts.

import { VENDORS } from "@/config/vendors";

export type CartKind = "shopify" | "amazon";
// One part's line: its product link, how many to buy and, for Shopify, the variant to buy.
export type CartLine = { url: string; quantity: number; variantId?: string | null };

const SHOPIFY_HOSTS = new Set(VENDORS.filter((v) => v.api === "shopify").map((v) => v.host.replace(/^www\./, "")));

function parse(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

// Which kind of cart a product link can go in, or null when its store has none.
export function cartKind(raw: string | null | undefined): CartKind | null {
  const u = raw ? parse(raw) : null;
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, "");
  if (SHOPIFY_HOSTS.has(host)) return /\/products\/[^/?#]+/.test(u.pathname) ? "shopify" : null;
  if (/^(smile\.)?amazon\.[a-z.]+$/.test(host)) return asinOf(u) ? "amazon" : null;
  return null;
}

// Amazon's product id: /dp/<ASIN>, /gp/product/<ASIN> or /gp/aw/d/<ASIN>.
function asinOf(u: URL) {
  return /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(u.pathname)?.[1]?.toUpperCase() ?? null;
}

// The Shopify variant a link names (?variant=<id>), else null: the store's .json has to be read.
export const linkVariant = (raw: string) => {
  const v = parse(raw)?.searchParams.get("variant");
  return v && /^\d+$/.test(v) ? v : null;
};

// The cart page with every line in it, the same product's lines added up. Null when the lines
// aren't all in one store that takes a cart link, or a Shopify line has no variant.
export function cartUrl(lines: CartLine[]): string | null {
  const first = lines[0] && parse(lines[0].url);
  const kind = lines[0] && cartKind(lines[0].url);
  if (!first || !kind) return null;
  const host = first.hostname.replace(/^www\./, "");
  const totals = new Map<string, number>();
  for (const line of lines) {
    const u = parse(line.url);
    if (!u || u.hostname.replace(/^www\./, "") !== host || cartKind(line.url) !== kind) return null;
    const key = kind === "shopify" ? (line.variantId ?? linkVariant(line.url)) : asinOf(u);
    if (!key) return null;
    const qty = Math.max(1, Math.round(line.quantity));
    totals.set(key, (totals.get(key) ?? 0) + qty);
  }
  const entries = [...totals];
  if (kind === "shopify") return `${first.origin}/cart/${entries.map(([id, q]) => `${id}:${q}`).join(",")}`;
  const query = entries.map(([asin, q], i) => `ASIN.${i + 1}=${asin}&Quantity.${i + 1}=${q}`).join("&");
  return `${first.origin}/gp/aws/cart/add.html?${query}`;
}
