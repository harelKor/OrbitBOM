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

export async function askGemini(jpegBase64: string, cats: InvCategory[]): Promise<{ answer: ModelAnswer; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new RecognizeError("Recognition isn't set up: the server has no GEMINI_API_KEY.");
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  const res = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: "image/jpeg", data: jpegBase64 } }, { text: prompt(cats) }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.1 },
    }),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (res.status === 429) throw new RecognizeError("The free recognition quota is used up for now. Try again later, or type it.");
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message;
    throw new RecognizeError(`Gemini answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; modelVersion?: string };
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    return { answer: JSON.parse(text) as ModelAnswer, model: body.modelVersion ?? model };
  } catch {
    throw new RecognizeError("Gemini's answer wasn't readable. Try another photo.");
  }
}
