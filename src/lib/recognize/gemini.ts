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

export const SCHEMA = {
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

// Google's free models are often "experiencing high demand" (503, Harel 2026-11-12), and a busy
// one may take 10 s to say so or not answer at all. So each model gets one short try, a model that
// failed sits out for a few minutes, and the one that answered last goes first. A model with its
// free quota used up (429) or gone (404) is skipped too, since each has its own quota.
// Measured from the server 2026-11-12 with a photo: Gemini 3 Flash preview 3-5 s and right,
// Flash-Lite 2 s, plain Flash busy (503 after 10 s, or no answer in 60 s); the 2.5 models are
// closed to new keys. Thinking "low" saves ~2 s and is enough to name a part.
// GEMINI_MODEL (comma-separated) replaces the list.
const MODELS = ["gemini-3-flash-preview", "gemini-flash-lite-latest", "gemini-flash-latest"];
const TRY_MS = 15_000;
const DEADLINE_MS = 45_000;
const SIT_OUT_MS = 5 * 60_000;
let lastGood: string | null = null;
const failedAt = new Map<string, number>();

export async function askGemini(jpegBase64: string, cats: InvCategory[]): Promise<{ answer: ModelAnswer; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new RecognizeError("Recognition isn't set up: the server has no GEMINI_API_KEY.");
  const list = process.env.GEMINI_MODEL ? process.env.GEMINI_MODEL.split(",").map((m) => m.trim()).filter(Boolean) : MODELS;
  const now = Date.now();
  const resting = (m: string) => now - (failedAt.get(m) ?? 0) < SIT_OUT_MS;
  const ordered = lastGood && list.includes(lastGood) ? [lastGood, ...list.filter((m) => m !== lastGood)] : list;
  const models = [...ordered.filter((m) => !resting(m)), ...ordered.filter(resting)];
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: "image/jpeg", data: jpegBase64 } }, { text: prompt(cats) }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.1, thinkingConfig: { thinkingLevel: "low" } },
  });
  const started = Date.now();
  const failures: number[] = [];
  let detail = "";
  for (const model of models) {
    const left = DEADLINE_MS - (Date.now() - started);
    if (left < 3000) break;
    const res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body,
      signal: AbortSignal.timeout(Math.min(TRY_MS, left)),
      cache: "no-store",
    }).catch(() => null);
    if (res?.ok) {
      const out = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; modelVersion?: string };
      const text = out.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      try {
        const answer = JSON.parse(text) as ModelAnswer;
        lastGood = model;
        failedAt.delete(model);
        return { answer, model: out.modelVersion ?? model };
      } catch {
        throw new RecognizeError("Gemini's answer wasn't readable. Try another photo.");
      }
    }
    const status = res?.status ?? 504; // no answer in time
    failures.push(status);
    failedAt.set(model, Date.now());
    if (res && status !== 503 && status !== 500) detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "";
    // A wrong or unpaid key won't get better on another model.
    if (status === 401 || status === 402 || status === 403) throw new RecognizeError(`Gemini answered ${status}${detail ? `: ${detail}` : ""}`);
  }
  if (failures.length && failures.every((s) => s === 400)) throw new RecognizeError(`Gemini answered 400${detail ? `: ${detail}` : ""}`);
  if (failures.length && failures.every((s) => s === 429)) throw new RecognizeError("The free recognition quota is used up for now. Try again later, or type it.");
  throw new RecognizeError("Google's free AI is too busy right now. Try again in a minute, or add it by hand.");
}
