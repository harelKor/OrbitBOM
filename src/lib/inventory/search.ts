import "server-only";
import { and, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { VENDORS, vendorOfUrl, type Vendor } from "@/config/vendors";
import { normUrl } from "./match";
import { UA, publicUrl, readProduct, toUsd } from "./product";
import { groupOffers, type Offer, type ProductGroup } from "./productGroups";
import { variantTokens } from "./shopifyVariant";
import { toEnglishQuery } from "./searchWords";

const { parts } = schema;

// Results are kept a day per search, so typing the same thing again doesn't ask the stores again.
const DAY = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; offers: Offer[] }>();
// A store slower than this is left out, so the box answers in about a second.
const STORE_MS = 1200;

type Suggest = { resources?: { results?: { products?: { title?: string; url?: string; image?: string; featured_image?: { url?: string }; price?: string; price_min?: string; vendor?: string }[] } } };

async function searchShopify(v: Vendor, q: string): Promise<Offer[]> {
  const url = `https://${v.host}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=6`;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(STORE_MS), cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as Suggest;
    const offers: Offer[] = (data.resources?.results?.products ?? []).flatMap((p) => {
      if (!p.title || !p.url) return [];
      const link = new URL(p.url, `https://${v.host}`);
      link.search = "";
      const image = p.featured_image?.url ?? p.image ?? null;
      const price = Number(p.price ?? p.price_min);
      return [{ vendor: v.name, url: link.toString(), title: p.title, image: image ? new URL(image, `https://${v.host}`).toString() : null, price: Number.isFinite(price) && price > 0 ? price : null }];
    });
    return await narrowToVariants(offers, q);
  } catch {
    return [];
  }
}

// A search naming a color, durometer or bore ("compliant wheel 3 inch blue 1/2 hex"): the first
// few family pages are opened for the variant it names, so the result shows that wheel's own
// picture, price and ?variant= link. Within the same time limit; a page that doesn't answer stays.
const narrows = (q: string) => [...variantTokens(q)].some((t) => !t.endsWith("in"));
async function narrowToVariants(offers: Offer[], q: string): Promise<Offer[]> {
  if (!narrows(q)) return offers;
  return Promise.all(
    offers.map((o, i) =>
      i >= 3
        ? o
        : readProduct(o.url, STORE_MS, q)
            .then((p) => (p.url !== o.url ? { ...o, url: p.url, title: p.title, image: p.image ?? o.image, price: p.price ?? o.price, sku: p.sku } : o))
            .catch(() => o),
    ),
  );
}

type Woo = { name?: string; permalink?: string; sku?: string; images?: { src?: string }[]; prices?: { price?: string; currency_code?: string; currency_minor_unit?: number } }[];

const unescape = (s: string) => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&").replace(/&quot;/g, '"');

async function searchWoo(v: Vendor, q: string): Promise<Offer[]> {
  const url = `https://${v.host}/wp-json/wc/store/v1/products?search=${encodeURIComponent(q)}&per_page=6`;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(STORE_MS), cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as Woo;
    return (Array.isArray(data) ? data : []).flatMap((p) => {
      if (!p.name || !p.permalink) return [];
      // Prices come in cents (or the currency's smallest unit).
      const price = Number(p.prices?.price) / 10 ** (p.prices?.currency_minor_unit ?? 2);
      return [{ vendor: v.name, url: p.permalink, title: unescape(p.name), image: p.images?.[0]?.src ?? null, price: price > 0 ? toUsd(price, p.prices?.currency_code ?? "USD") : null, sku: p.sku || null }];
    });
  } catch {
    return [];
  }
}

// COTS parts already in a robot's BOM with a product link (often filled from FRCDesignLib by a
// member's Claude): the same product found again costs nothing.
async function searchBom(q: string): Promise<Offer[]> {
  const words = q.split(/\s+/).filter((w) => w.length > 1).slice(0, 6);
  if (!words.length) return [];
  const rows = await db
    .select({ name: sql<string>`coalesce(${parts.displayName}, ${parts.onshapeName})`, links: parts.cotsLinks, price: parts.unitPrice, partNumber: parts.partNumber })
    .from(parts)
    .where(
      and(
        isNull(parts.removedFromCadAt),
        sql`jsonb_array_length(${parts.cotsLinks}) > 0`,
        ...words.map((w) => sql`(coalesce(${parts.displayName}, ${parts.onshapeName}, '') || ' ' || coalesce(${parts.partNumber}, '')) ilike ${`%${w}%`}`),
      ),
    )
    .limit(20);
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    const link = r.links[0];
    if (!link || seen.has(link.url) || !publicUrl(link.url)) return [];
    seen.add(link.url);
    return [{ vendor: link.site || vendorOfUrl(link.url), url: link.url, title: r.name, image: null, price: link.priceUsd ?? r.price ?? null, sku: r.partNumber }];
  });
}

const SERPER = "https://google.serper.dev";
const parsePrice = (s: string | undefined) => {
  const m = s?.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return toUsd(Number(m[1]), s!.includes("₪") ? "ILS" : "USD");
};

async function serper<T>(path: string, q: string): Promise<T | null> {
  const key = process.env.SERPER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${SERPER}/${path}`, {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ q, num: 10 }),
      signal: AbortSignal.timeout(2500),
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

type Shopping = { shopping?: { title?: string; source?: string; link?: string; price?: string; imageUrl?: string }[] };
type Organic = { organic?: { link?: string }[] };

// Anything the FRC stores don't sell (glue, wire, taps, hand tools): Google Shopping through
// Serper, and the top web pages read for their own product tags (photo, price). Only when
// SERPER_API_KEY is set; there is no free web search a server may call, so without it the box
// links to Amazon, McMaster, DigiKey and Mouser instead.
export async function searchWebProducts(q: string): Promise<Offer[]> {
  const [shop, web] = await Promise.all([serper<Shopping>("shopping", q), serper<Organic>("search", q)]);
  const offers: Offer[] = (shop?.shopping ?? []).flatMap((p) => {
    const url = p.link && publicUrl(p.link);
    // Google's own product pages aren't a store to buy from.
    if (!p.title || !url || /(^|\.)google\./.test(url.hostname)) return [];
    return [{ vendor: p.source || vendorOfUrl(url.toString()), url: url.toString(), title: p.title, image: p.imageUrl ?? null, price: parsePrice(p.price) }];
  });
  const pages = (web?.organic ?? []).map((r) => r.link).filter((l): l is string => !!l && !!publicUrl(l)).slice(0, 5);
  const read = await Promise.all(
    pages.map((url) =>
      readProduct(url, 2500)
        .then((p): Offer[] => (p.image || p.price != null ? [{ vendor: vendorOfUrl(p.url), url: p.url, title: p.title, image: p.image, price: toUsd(p.price, p.currency), sku: p.sku }] : []))
        .catch(() => []),
    ),
  );
  return [...offers.slice(0, 8), ...read.flat()];
}

// How much of the query a product's name has: the closest matches come first. Whole words (or
// their start, for "taps" and "tapered"), so "ca" doesn't match "polycarbonate".
function relevance(title: string, words: string[]) {
  const t = title.toLowerCase().split(/[^a-z0-9.#]+/);
  return words.filter((w) => t.some((x) => x === w || (w.length > 2 && x.startsWith(w)))).length / (words.length || 1);
}

export async function searchProducts(query: string): Promise<{ groups: ProductGroup[]; elsewhere: { name: string; url: string }[]; english: string | null }> {
  const q = query.trim().replace(/\s+/g, " ").slice(0, 80);
  // The stores are searched in English; Hebrew is turned into shop words first (the team's own
  // BOM is searched with what was typed).
  const english = toEnglishQuery(q);
  const eq = english ?? q;
  const elsewhere = VENDORS.filter((v) => !v.api).map((v) => ({ name: v.name, url: v.searchUrl(v.hebrew ? q : eq) }));
  if (q.length < 3) return { groups: [], elsewhere, english };
  const key = q.toLowerCase();
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > DAY) {
    const stores = await Promise.all([searchBom(q), ...(english ? [searchBom(english)] : []), ...VENDORS.filter((v) => v.api).map((v) => (v.api === "woo" ? searchWoo : searchShopify)(v, eq))]);
    // Few store results (shop supplies, tools): look on the wider web too.
    const words = eq.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    const good = stores.flat().filter((o) => relevance(o.title, words) >= 0.5).length;
    const lists = good < 5 ? [...stores, await searchWebProducts(eq)] : stores;
    // One from each store in turn, so no single store fills the list.
    const offers: Offer[] = [];
    const seen = new Set<string>();
    for (let i = 0; lists.some((l) => l[i]); i++)
      for (const l of lists) {
        const o = l[i];
        if (!o || seen.has(normUrl(o.url))) continue;
        seen.add(normUrl(o.url));
        offers.push(o);
      }
    hit = { at: Date.now(), offers };
    // An empty answer may be a store that stopped answering: ask again next time.
    if (offers.length) cache.set(key, hit);
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
  }
  const words = eq.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const groups = groupOffers(hit.offers)
    .map((g, i) => ({ g, i, r: relevance(g.title, words) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.g);
  return { groups: groups.slice(0, 12), elsewhere, english };
}
