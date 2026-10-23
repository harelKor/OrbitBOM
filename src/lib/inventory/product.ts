import "server-only";
import { createHash } from "node:crypto";
import { ILS_PER_USD } from "@/config/cots";
import { putObject, storageConfigured } from "@/lib/storage/r2";
import { readProductPage, type Product } from "./productPage";

export type { Product };

const UA = "Mozilla/5.0 (compatible; OrbitMech-BOM/1.0; +https://orbit-bom.vercel.app)";

// Only public web pages: no local or private addresses, so a pasted link can't reach inside.
export function publicUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":") || h.startsWith("[")) return null;
  return u;
}

async function get(url: URL, accept: string, maxBytes: number, ms = 8000) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: AbortSignal.timeout(ms), cache: "no-store" });
  if (!res.ok) throw new Error(`The site answered ${res.status}.`);
  if (!publicUrl(res.url)) throw new Error("The link redirected somewhere private.");
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new Error("The page is too big to read.");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("The page is too big to read.");
  return { bytes, type: res.headers.get("content-type") ?? "", finalUrl: res.url };
}

// A pasted product link: the page's own product tags (the ones stores publish for Google).
export async function readProduct(raw: string): Promise<Product> {
  const url = publicUrl(raw);
  if (!url) throw new Error("That isn't a web link.");
  const page = await get(url, "text/html,application/xhtml+xml", 3_000_000);
  return readProductPage(new TextDecoder().decode(page.bytes), page.finalUrl);
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
