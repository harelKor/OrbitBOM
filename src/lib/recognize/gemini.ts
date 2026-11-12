import "server-only";
import type { InvCategory } from "@/lib/inventory/categories";
import { prompt, type ModelAnswer } from "./answer";

// Google's Gemini API on its free tier (Harel, 2026-11-11, plan/item-recognition.md). The key is
// from Google AI Studio with no billing account attached, so it can't be charged: past the free
// limit Google answers 429 and the scan falls back to typing. On the free tier Google may use the
// photos to improve its products; the scan screen says so. The key stays on the server.
// GEMINI_MODEL picks the model; the default follows Google's newest Flash.

const API = "https://generativelanguage.googleapis.com/v1beta/models";

export const geminiConfigured = () => !!process.env.GEMINI_API_KEY;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    categoryId: { type: "STRING" },
    specs: { type: "ARRAY", items: { type: "OBJECT", properties: { field: { type: "STRING" }, value: { type: "STRING" } }, required: ["field", "value"] } },
    brand: { type: "STRING" },
    product: { type: "STRING" },
    partNumber: { type: "STRING" },
    searchQuery: { type: "STRING" },
    textSeen: { type: "STRING" },
    confidence: { type: "NUMBER" },
    alternatives: { type: "ARRAY", items: { type: "OBJECT", properties: { categoryId: { type: "STRING" }, product: { type: "STRING" } }, required: ["categoryId", "product"] } },
  },
  required: ["categoryId", "specs", "brand", "product", "partNumber", "searchQuery", "textSeen", "confidence", "alternatives"],
};

export class RecognizeError extends Error {}

// Google's free models are often "experiencing high demand" (503, Harel 2026-11-12): each is
// tried twice, then the next one; the one that answered last goes first next time. A model with
// its free quota used up (429) or gone (404) is skipped too, since each has its own quota.
// GEMINI_MODEL (comma-separated) replaces the list.
// Checked 2026-11-12: the 2.5 models are closed to new keys; a preview that goes away answers 404 and is skipped.
const MODELS = ["gemini-flash-latest", "gemini-3-flash-preview", "gemini-flash-lite-latest"];
let lastGood: string | null = null;
const DEADLINE_MS = 50_000;

export async function askGemini(jpegBase64: string, cats: InvCategory[]): Promise<{ answer: ModelAnswer; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new RecognizeError("Recognition isn't set up: the server has no GEMINI_API_KEY.");
  const list = process.env.GEMINI_MODEL ? process.env.GEMINI_MODEL.split(",").map((m) => m.trim()).filter(Boolean) : MODELS;
  const models = lastGood && list.includes(lastGood) ? [lastGood, ...list.filter((m) => m !== lastGood)] : list;
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: "image/jpeg", data: jpegBase64 } }, { text: prompt(cats) }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.1 },
  });
  const started = Date.now();
  const failures: number[] = [];
  let detail = "";
  for (const model of models)
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = DEADLINE_MS - (Date.now() - started);
      if (left < 3000) break;
      const res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body,
        signal: AbortSignal.timeout(Math.min(25_000, left)),
        cache: "no-store",
      }).catch(() => null);
      if (res?.ok) {
        const out = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; modelVersion?: string };
        const text = out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
        try {
          const answer = JSON.parse(text) as ModelAnswer;
          lastGood = model;
          return { answer, model: out.modelVersion ?? model };
        } catch {
          throw new RecognizeError("Gemini's answer wasn't readable. Try another photo.");
        }
      }
      const status = res?.status ?? 504; // no answer in time
      failures.push(status);
      if (res && status !== 503 && status !== 500) detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "";
      // A wrong key or a bad request won't get better on another model.
      if (status === 400 || status === 401 || status === 403 || status === 402) throw new RecognizeError(`Gemini answered ${status}${detail ? `: ${detail}` : ""}`);
      if (status !== 503 && status !== 500 && status !== 504) break; // 429 / 404: straight to the next model
      await new Promise((r) => setTimeout(r, 800));
    }
  if (failures.length && failures.every((s) => s === 429)) throw new RecognizeError("The free recognition quota is used up for now. Try again later, or type it.");
  throw new RecognizeError("Google's free AI is too busy right now. Try again in a minute, or add it by hand.");
}
