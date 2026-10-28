import "server-only";
import { and, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { VENDORS, vendorOfUrl, type Vendor } from "@/config/vendors";
import { normUrl } from "./match";
import { UA, publicUrl } from "./product";
import { groupOffers, type Offer, type ProductGroup } from "./productGroups";

const { parts } = schema;

// Results are kept a day per search, so typing the same thing again doesn't ask the stores again.
const DAY = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; offers: Offer[] }>();

type Suggest = { resources?: { results?: { products?: { title?: string; url?: string; image?: string; featured_image?: { url?: string }; price?: string; price_min?: string; vendor?: string }[] } } };

async function searchShopify(v: Vendor, q: string): Promise<Offer[]> {
  const url = `https://${v.host}/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=6`;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(4000), cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as Suggest;
    return (data.resources?.results?.products ?? []).flatMap((p) => {
      if (!p.title || !p.url) return [];
      const link = new URL(p.url, `https://${v.host}`);
      link.search = "";
      const image = p.featured_image?.url ?? p.image ?? null;
      const price = Number(p.price ?? p.price_min);
      return [{ vendor: v.name, url: link.toString(), title: p.title, image: image ? new URL(image, `https://${v.host}`).toString() : null, price: Number.isFinite(price) && price > 0 ? price : null }];
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

export async function searchProducts(query: string): Promise<{ groups: ProductGroup[]; elsewhere: { name: string; url: string }[] }> {
  const q = query.trim().replace(/\s+/g, " ").slice(0, 80);
  const elsewhere = VENDORS.filter((v) => !v.shopify).map((v) => ({ name: v.name, url: v.searchUrl(q) }));
  if (q.length < 3) return { groups: [], elsewhere };
  const key = q.toLowerCase();
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > DAY) {
    const lists = await Promise.all([searchBom(q), ...VENDORS.filter((v) => v.shopify).map((v) => searchShopify(v, q))]);
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
  return { groups: groupOffers(hit.offers).slice(0, 12), elsewhere };
}
