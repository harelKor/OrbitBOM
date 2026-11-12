import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { listCategories } from "@/lib/data/categories";
import type { Offer, ProductGroup } from "@/lib/inventory/productGroups";
import { searchProducts } from "@/lib/inventory/search";
import { cleanAnswer } from "@/lib/recognize/answer";
import { askGemini, RecognizeError } from "@/lib/recognize/gemini";
import { lensSearch } from "@/lib/recognize/lens";

// Scan anything (plan/item-recognition.md): the phone sends one shrunk photo (and its own tooth
// count), Gemini says what it is, the answer comes back in our categories' words with the best
// store offers. A route handler, not a server action, so a slow answer doesn't hold up saving.
// Stores are asked only about a named product, for a few seconds at most (it was slow: Harel,
// 2026-11-12). No name, or no store has it: the photo itself is searched on the web (Lens), for
// COTS, electrical and tools only; a gear, a bolt or a tube gets nothing useful from it.
// A cap a day keeps a stuck phone from using up the team's free quota.

const DAILY_CAP = 300;
const STORES_MS = 5000;
const LENS_GROUPS = new Set(["cots", "electrical", "tools"]);
let day = "";
let used = 0;

const within = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

export async function POST(req: Request) {
  if (!(await getMember())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const today = new Date().toISOString().slice(0, 10);
  if (day !== today) {
    day = today;
    used = 0;
  }
  if (used >= DAILY_CAP) return NextResponse.json({ error: "That's enough scans for today. Type it instead." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { image?: unknown; teeth?: unknown } | null;
  const image = typeof body?.image === "string" ? body.image.replace(/^data:image\/jpeg;base64,/, "") : "";
  if (!image || image.length > 2_000_000 || !/^[A-Za-z0-9+/=]+$/.test(image)) return NextResponse.json({ error: "Send one JPEG photo under 1.5 MB." }, { status: 400 });
  const teeth = typeof body?.teeth === "number" && body.teeth > 0 && body.teeth < 400 ? Math.round(body.teeth) : null;

  used++;
  const started = Date.now();
  try {
    const cats = await listCategories();
    const { answer, model } = await askGemini(image, cats);
    const modelMs = Date.now() - started;
    const result = cleanAnswer(answer, cats, { teeth });
    const found = result.name && result.searchQuery ? await within(searchProducts(result.searchQuery), STORES_MS, null) : null;
    let groups: ProductGroup[] = found?.groups ?? [];
    const storesMs = Date.now() - started - modelMs;
    const cat = cats.find((c) => c.id === result.categoryId);
    let lens = false;
    if (!groups.length && !result.toothed && (!cat || LENS_GROUPS.has(cat.group))) {
      const offers: Offer[] = await lensSearch(Buffer.from(image, "base64"));
      if (offers.length) {
        groups = [{ title: offers[0].title, image: offers[0].image, offers }];
        lens = true;
      }
    }
    const offers = groups.slice(0, 3).map((g) => ({ title: g.title, image: g.image, offers: g.offers.slice(0, 3) }));
    return NextResponse.json({ result, offers, lens, raw: answer, model, ms: { model: modelMs, stores: storesMs, total: Date.now() - started } });
  } catch (e) {
    if (e instanceof RecognizeError) return NextResponse.json({ error: e.message }, { status: 502 });
    throw e;
  }
}
