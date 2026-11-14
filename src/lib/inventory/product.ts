import "server-only";
import { createHash } from "node:crypto";
import dns, { type LookupAddress } from "node:dns";
import https from "node:https";
import type { LookupFunction } from "node:net";
import zlib from "node:zlib";
import { ILS_PER_USD } from "@/config/cots";
import { VENDORS } from "@/config/vendors";
import { isPrivateAddress } from "@/lib/net/address";
import { putObject, storageConfigured } from "@/lib/storage/r2";
import { readProductPage, siteOf, type Product } from "./productPage";
import { pickVariant, variantImage, variantTitle, type ShopifyProduct } from "./shopifyVariant";

export type { Product };

const UA = "Mozilla/5.0 (compatible; OrbitParts-BOM/1.0; +https://orbitparts.duckdns.org)";

// Only public web pages over HTTPS: no local or private addresses, so a pasted link can't reach
// inside. This checks the name; get() checks the address it resolves to as well.
export function publicUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  if (u.port && u.port !== "443") return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || h.startsWith("[")) return null;
  return u;
}

// A DNS lookup that refuses private addresses. The socket connects to the address checked here,
// so a name can't resolve to a public address for the check and a private one for the request.
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, family: options.family, hints: options.hints }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error("The link points to a private address."), { code: "EPRIVATE" }), "", 4);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

const MAX_HOPS = 5;

// One page or picture from the public web: HTTPS only, each redirect checked again, the address
// pinned by publicLookup, at most `maxBytes`, and `ms` for the whole thing.
async function get(start: URL, accept: string, maxBytes: number, ms = 8000) {
  const signal = AbortSignal.timeout(ms);
  let url = start;
  for (let hop = 0; ; hop++) {
    if (!publicUrl(url.toString())) throw new Error("The link redirected somewhere private.");
    const res = await request(url, accept, maxBytes, signal);
    if (res.status >= 300 && res.status < 400 && res.location) {
      if (hop >= MAX_HOPS) throw new Error("The link redirected too many times.");
      url = new URL(res.location, url);
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`The site answered ${res.status}.`);
    return { bytes: res.bytes, type: res.type, finalUrl: url.toString() };
  }
}

function request(url: URL, accept: string, maxBytes: number, signal: AbortSignal) {
  return new Promise<{ status: number; location: string | null; type: string; bytes: Uint8Array }>((resolve, reject) => {
    const req = https.get(url, { headers: { "user-agent": UA, accept, "accept-encoding": "gzip, deflate, br" }, lookup: publicLookup, signal }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) {
        res.resume();
        return resolve({ status, location: res.headers.location ?? null, type: "", bytes: new Uint8Array() });
      }
      if (Number(res.headers["content-length"] ?? 0) > maxBytes) {
        res.destroy();
        return reject(new Error("The page is too big to read."));
      }
      const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
      const body: NodeJS.ReadableStream =
        encoding === "gzip" ? res.pipe(zlib.createGunzip()) : encoding === "deflate" ? res.pipe(zlib.createInflate()) : encoding === "br" ? res.pipe(zlib.createBrotliDecompress()) : res;
      const chunks: Buffer[] = [];
      let size = 0;
      body.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          res.destroy();
          reject(new Error("The page is too big to read."));
        } else chunks.push(c);
      });
      body.on("end", () => resolve({ status, location: null, type: String(res.headers["content-type"] ?? ""), bytes: new Uint8Array(Buffer.concat(chunks)) }));
      body.on("error", reject);
      res.on("error", reject);
    });
    req.on("error", (err) => reject((err as { code?: string }).code === "EPRIVATE" ? new Error("The link points to a private address.") : err));
  });
}

// A pasted product link: the page's own product tags (the ones stores publish for Google). On a
// Shopify store the product's .json is read first, so a ?variant= link, or a `want` naming a
// color, durometer or bore ("2\" Stealth wheel – blue, 1/2\" Hex"), gets that variant's own link,
// picture, price and title instead of the family page's.
export async function readProduct(raw: string, ms?: number, want?: string | null): Promise<Product> {
  const url = publicUrl(raw);
  if (!url) throw new Error("That isn't a web link.");
  const shopify = await readShopify(url, ms, want).catch(() => null);
  if (shopify) return shopify;
  const page = await get(url, "text/html,application/xhtml+xml", 3_000_000, ms);
  return readProductPage(new TextDecoder().decode(page.bytes), page.finalUrl);
}

async function readShopify(url: URL, ms: number | undefined, want: string | null | undefined): Promise<Product | null> {
  // Only the searched Shopify stores: they sell in dollars, and the .json doesn't say.
  const host = url.hostname.replace(/^www\./, "");
  if (!VENDORS.some((s) => s.api === "shopify" && s.host.replace(/^www\./, "") === host)) return null;
  const handle = /\/products\/([^/?#.]+)\/?$/.exec(url.pathname)?.[1];
  if (!handle) return null;
  const json = new URL(`/products/${handle}.json`, url);
  const res = await get(json, "application/json", 3_000_000, ms);
  const p = (JSON.parse(new TextDecoder().decode(res.bytes)) as { product?: ShopifyProduct }).product;
  if (!p?.variants?.length) return null;
  const v = pickVariant(p, { variantId: url.searchParams.get("variant"), want });
  const link = new URL(`/products/${p.handle}`, url);
  if (v && p.variants.length > 1) link.searchParams.set("variant", String(v.id));
  const image = (v && variantImage(p, v)?.src) || p.image?.src || p.images[0]?.src || null;
  const price = Number((v ?? p.variants[0]).price);
  return {
    url: link.toString(),
    site: siteOf(link.toString()),
    title: variantTitle(p, v),
    image: image ? new URL(image, link).toString() : null,
    price: Number.isFinite(price) && price > 0 && (v || p.variants.length === 1) ? price : null,
    currency: "USD",
    sku: (v ?? (p.variants.length === 1 ? p.variants[0] : null))?.sku || null,
  };
}

// The variant an Order List cart buys for a Shopify link with no ?variant=: the one the part's
// name points to, else the product's first (the buyer can change it in the store's cart).
export async function shopifyVariantId(raw: string, want: string | null, ms = 6000): Promise<string | null> {
  const url = publicUrl(raw);
  const handle = url && /\/products\/([^/?#.]+)\/?$/.exec(url.pathname)?.[1];
  if (!url || !handle) return null;
  const res = await get(new URL(`/products/${handle}.json`, url), "application/json", 3_000_000, ms);
  const p = (JSON.parse(new TextDecoder().decode(res.bytes)) as { product?: ShopifyProduct }).product;
  if (!p?.variants?.length) return null;
  return String((pickVariant(p, { want }) ?? p.variants[0]).id);
}

// Prices are kept in dollars, like COTS parts.
export function toUsd(price: number | null, currency: string | null): number | null {
  if (price == null || !Number.isFinite(price)) return null;
  const c = (currency ?? "USD").toUpperCase();
  if (c === "USD") return Math.round(price * 100) / 100;
  if (c === "ILS") return Math.round((price / ILS_PER_USD) * 100) / 100;
  return null;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };

// The product's picture, copied once into R2 so it keeps working when the store changes its
// site. Returns the R2 key, or null when it can't be saved.
export async function saveProductPhoto(itemId: string, imageUrl: string): Promise<string | null> {
  const url = publicUrl(imageUrl);
  if (!url || !storageConfigured()) return null;
  // A BOM part's CAD thumbnail is never a product photo (Harel, 2026-10-31).
  if (/\/thumbs\/parts\//.test(url.pathname)) return null;
  try {
    const img = await get(url, "image/*", 5_000_000);
    const type = img.type.split(";")[0].trim().toLowerCase();
    const ext = EXT[type];
    if (!ext) return null;
    const key = `inventory/${itemId}/${createHash("sha1").update(img.bytes).digest("hex").slice(0, 12)}.${ext}`;
    await putObject(key, img.bytes, type);
    return key;
  } catch {
    return null;
  }
}

export { UA, get as fetchPublic };
