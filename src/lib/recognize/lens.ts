import "server-only";
import { randomUUID } from "node:crypto";
import { VENDORS, vendorOfUrl } from "@/config/vendors";
import { publicUrl, readProduct, toUsd } from "@/lib/inventory/product";
import type { Offer } from "@/lib/inventory/productGroups";
import { deleteObject, presignDownload, putObject, storageConfigured } from "@/lib/storage/r2";

// The photo searched on the whole web, like Google Lens (Harel, 2026-11-12), through Serper's
// Lens search on the key the add box's web search already uses. Google Lens has no API of its own
// and Gemini's Google Search answers "quota exceeded" on the free tier (checked 2026-11-12).
// Each search costs 3 of Serper's free credits, shared with the add box, so it runs only when
// Gemini didn't name the product or the stores found nothing for it, and at most LENS_DAILY a
// day. Serper fetches the photo from a 5-minute R2 link; the copy is deleted straight after.

const LENS_DAILY = 30;
let day = "";
let used = 0;

const STORES = new Set(VENDORS.map((v) => v.host.replace(/^www\./, "")));
const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");
// Forums, docs and videos show the part but don't sell it.
const NOT_A_SHOP = /(^|\.)(chiefdelphi\.com|reddit\.com|youtube\.com|github\.com|facebook\.com|instagram\.com|pinterest\.|docs\.|wikipedia\.org)/;

export const lensConfigured = () => !!process.env.SERPER_API_KEY && storageConfigured();

type LensHit = { title?: string; link?: string; source?: string; imageUrl?: string; thumbnailUrl?: string; price?: string };

export async function lensSearch(jpeg: Buffer): Promise<Offer[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key || !storageConfigured()) return [];
  const today = new Date().toISOString().slice(0, 10);
  if (day !== today) {
    day = today;
    used = 0;
  }
  if (used >= LENS_DAILY) return [];
  used++;
  const objectKey = `scan/${randomUUID()}.jpg`;
  try {
    await putObject(objectKey, jpeg, "image/jpeg");
    const url = await presignDownload(objectKey, "scan.jpg", true, "image/jpeg");
    const res = await fetch("https://google.serper.dev/lens", {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const hits = (((await res.json()) as { organic?: LensHit[] }).organic ?? []).filter((h) => h.title && h.link && publicUrl(h.link) && !NOT_A_SHOP.test(hostOf(h.link)));
    // The team's own stores first, then other shops.
    hits.sort((a, b) => Number(STORES.has(hostOf(b.link!))) - Number(STORES.has(hostOf(a.link!))));
    // Each page's own product tags give the real photo and price (Lens gives neither reliably).
    const read = await Promise.all(
      hits.slice(0, 4).map(async (h): Promise<Offer | null> => {
        const p = await readProduct(h.link!, 2500).catch(() => null);
        if (!p && !STORES.has(hostOf(h.link!))) return null;
        return { vendor: h.source || vendorOfUrl(h.link!), url: p?.url ?? h.link!, title: p?.title || h.title!, image: p?.image ?? h.imageUrl ?? h.thumbnailUrl ?? null, price: p ? toUsd(p.price, p.currency) : null, sku: p?.sku };
      }),
    );
    return read.filter((o): o is Offer => !!o);
  } catch {
    return [];
  } finally {
    void deleteObject(objectKey).catch(() => {});
  }
}
