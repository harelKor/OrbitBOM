import { NextResponse } from "next/server";
import { getMember } from "@/lib/auth";
import { listCategories } from "@/lib/data/categories";
import { cleanAnswer } from "@/lib/recognize/answer";
import { askGemini, RecognizeError } from "@/lib/recognize/gemini";
import { readScanPhoto } from "@/lib/recognize/photo";

// Scan anything (plan/item-recognition.md): the phone sends one shrunk photo (and its own tooth
// count), Gemini says what it is, and the answer comes back in our categories' words. Only that,
// so the specs show in a few seconds (Harel, 2026-11-13: "instant results"); the photo search
// (/api/inventory/lens) and the store search (/api/inventory/search) run beside it from the phone.
// A route handler, not a server action, so a slow answer doesn't hold up saving.
// A cap a day keeps a stuck phone from using up the team's free quota.

const DAILY_CAP = 300;
let day = "";
let used = 0;

export async function POST(req: Request) {
  if (!(await getMember())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const today = new Date().toISOString().slice(0, 10);
  if (day !== today) {
    day = today;
    used = 0;
  }
  if (used >= DAILY_CAP) return NextResponse.json({ error: "That's enough scans for today. Type it instead." }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { image?: unknown; teeth?: unknown } | null;
  const image = readScanPhoto(body?.image);
  if (!image) return NextResponse.json({ error: "Send one JPEG photo under 1.5 MB." }, { status: 400 });
  const teeth = typeof body?.teeth === "number" && body.teeth > 0 && body.teeth < 400 ? Math.round(body.teeth) : null;

  used++;
  const started = Date.now();
  try {
    const cats = await listCategories();
    const { answer, model } = await askGemini(image, cats);
    const result = cleanAnswer(answer, cats, { teeth });
    return NextResponse.json({ result, raw: answer, model, ms: { model: Date.now() - started } });
  } catch (e) {
    if (e instanceof RecognizeError) return NextResponse.json({ error: e.message }, { status: 502 });
    throw e;
  }
}
