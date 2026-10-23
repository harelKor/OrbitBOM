// Reads a product page's standard tags: Open Graph (og:title, og:image, product:price:amount),
// schema.org Product in JSON-LD, then the <title>. Plain text work, so it is tested on its own.

export type Product = {
  url: string;
  site: string;
  title: string;
  image: string | null;
  price: number | null;
  currency: string | null;
  sku: string | null;
};

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();

function meta(html: string, name: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (key?.toLowerCase() !== name) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const v = content?.[1] ?? content?.[2];
    if (v) return decode(v);
  }
  return null;
}

type Ld = Record<string, unknown>;
function ldProduct(html: string): Ld | null {
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const queue: unknown[] = [data];
    while (queue.length) {
      const node = queue.shift();
      if (Array.isArray(node)) queue.push(...node);
      else if (node && typeof node === "object") {
        const o = node as Ld;
        const type = o["@type"];
        if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return o;
        if (o["@graph"]) queue.push(o["@graph"]);
      }
    }
  }
  return null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);

export function siteOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function readProductPage(html: string, url: string): Product {
  const ld = ldProduct(html);
  const offer = first(ld?.offers) as Ld | undefined;
  const ldImage = first(ld?.image);
  const title = str(ld?.name) ?? meta(html, "og:title") ?? meta(html, "twitter:title") ?? decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const image = (typeof ldImage === "object" && ldImage ? str((ldImage as Ld).url) : str(ldImage)) ?? meta(html, "og:image") ?? meta(html, "og:image:secure_url") ?? meta(html, "twitter:image");
  const priceText = str(offer?.price) ?? str(offer?.lowPrice) ?? meta(html, "product:price:amount") ?? meta(html, "og:price:amount");
  const price = priceText ? Number(priceText.replace(/[^\d.]/g, "")) : NaN;
  let abs: string | null = null;
  if (image) {
    try {
      abs = new URL(decode(image), url).toString();
    } catch {}
  }
  return {
    url,
    site: siteOf(url),
    // "Kraken X60 | WCP" → "Kraken X60": the store's name after the last " | " or " - " goes.
    title: title.replace(/\s+[|–-]\s+[^|–]*$/, (tail) => (title.length - tail.length > 8 ? "" : tail)).trim() || siteOf(url),
    image: abs,
    price: Number.isFinite(price) && price > 0 ? price : null,
    currency: str(offer?.priceCurrency) ?? meta(html, "product:price:currency") ?? meta(html, "og:price:currency"),
    sku: str(ld?.sku) ?? str(ld?.mpn),
  };
}
