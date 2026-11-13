import "server-only";
import { randomUUID } from "node:crypto";
import { VENDORS, vendorOfUrl } from "@/config/vendors";
import { publicUrl, toUsd } from "@/lib/inventory/product";
import type { Offer } from "@/lib/inventory/productGroups";
import { deleteObject, presignDownload, putObject, storageConfigured } from "@/lib/storage/r2";

// The photo searched on the whole web, like Google Lens (Harel, 2026-11-12/13), through Serper's
// Lens search on the key the add box's web search already uses. Google Lens has no API of its own
// and Gemini's Google Search answers "quota exceeded" on the free tier (checked 2026-11-12).
// Every Capture runs it now, beside the AI, and its hits come back as they are (no page reads),
// so they show in seconds. Each search costs 3 of Serper's free credits, shared with the add box,
// so at most LENS_DAILY a day. Serper fetches the photo from a 5-minute R2 link; the copy is
// deleted straight after.

const LENS_DAILY = 60;
let day = "";
let used = 0;

const STORES = new Set(VENDORS.map((v) => v.host.replace(/^www\./, "")));
const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, "");
// Forums, docs and videos show the part but don't sell it.
const NOT_A_SHOP = /(^|\.)(chiefdelphi\.com|reddit\.com|youtube\.com|github\.com|facebook\.com|instagram\.com|pinterest\.|docs\.|wikipedia\.org|x\.com|twitter\.com|tiktok\.com)/;

export const lensConfigured = () => !!process.env.SERPER_API_KEY && storageConfigured();

type LensHit = { title?: string; link?: string; source?: string; imageUrl?: string; thumbnailUrl?: string; price?: string };

const parsePrice = (s: string | undefined) => {
  const m = s?.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? toUsd(Number(m[1]), s!.includes("₪") ? "ILS" : s!.includes("€") ? "EUR" : "USD") : null;
};

export async function lensSearch(jpeg: Buffer): Promise<{ offers: Offer[]; error?: string }> {
  const key = process.env.SERPER_API_KEY;
  if (!key || !storageConfigured()) return { offers: [], error: "The photo search isn't set up on the server." };
  const today = new Date().toISOString().slice(0, 10);
  if (day !== today) {
    day = today;
    used = 0;
  }
  if (used >= LENS_DAILY) return { offers: [], error: "The photo search is used up for today." };
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
    if (!res.ok) return { offers: [], error: `The photo search answered ${res.status}.` };
    const hits = (((await res.json()) as { organic?: LensHit[] }).organic ?? []).filter((h) => h.title && h.link && publicUrl(h.link) && !NOT_A_SHOP.test(hostOf(h.link)));
    // The team's own stores first, then other shops, in Google's order.
    hits.sort((a, b) => Number(STORES.has(hostOf(b.link!))) - Number(STORES.has(hostOf(a.link!))));
    return {
      offers: hits.slice(0, 12).map((h) => ({ vendor: h.source || vendorOfUrl(h.link!), url: h.link!, title: h.title!, image: h.imageUrl ?? h.thumbnailUrl ?? null, price: parsePrice(h.price) })),
    };
  } catch {
    return { offers: [], error: "The photo search didn't answer." };
  } finally {
    void deleteObject(objectKey).catch(() => {});
  }
}
