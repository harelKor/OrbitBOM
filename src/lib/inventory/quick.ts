// Smart typing in the add box: "36t htd 1/2 hex pulley" → Pulleys, teeth 36, pitch HTD 5mm,
// bore 1/2" Hex. Plain pattern matching, no AI. Option fields go first (each claims the words it
// used), then number fields read the rest through their name pattern ("{}T" reads "36t").

import { guessCategory } from "@/config/inventory";
import { fieldChoices, type InvCategory } from "./categories";

const UNIT = /^\d+(\.\d+)?(mm|in|t)?$/;
const FRACTIONS: Record<string, string> = { "½": "1/2", "⅜": "3/8", "¼": "1/4", "¾": "3/4", "⅝": "5/8" };

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[½⅜¼¾⅝]/g, (c) => ` ${FRACTIONS[c]} `)
    .replace(/(\d)\s*(?:"|''|inch(es)?\b)/g, "$1 in ")
    .replace(/(\d)\s*-\s*(\d)/g, "$1 $2")
    .split(/[^a-z0-9/.#]+/)
    .filter((t) => t && t !== "in" && t !== "x");
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pickOption(choices: string[], words: string[]): { value: string; used: string[] } | null {
  let best: { value: string; used: string[]; score: number } | null = null;
  for (const choice of choices) {
    const want = tokens(choice);
    if (!want.length) continue;
    const used = want.filter((t) => words.includes(t));
    const score = used.length / want.length;
    // A part match needs a real word (htd, hex, 6061), not just a size that many options share.
    if (score < 1 && (score < 0.5 || !used.some((t) => (/[a-z]/.test(t) && !UNIT.test(t)) || /^\d{4}$/.test(t)))) continue;
    if (!best || score > best.score || (score === best.score && want.length > tokens(best.value).length)) best = { value: choice, used, score };
  }
  return best && { value: best.value, used: best.used };
}

// left: the words it couldn't place (the category's own name doesn't count). None left means the
// whole line was understood, so Enter can save it straight away.
export type QuickParse = { categoryId: string; specs: Record<string, string>; left: string[] };

export function parseQuick(text: string, cats: InvCategory[]): QuickParse | null {
  const lower = text.toLowerCase();
  const named = cats.find((c) => [c.noun, c.label].some((w) => w && new RegExp(`\\b${escape(w.toLowerCase())}s?\\b`).test(lower)));
  const categoryId = named?.id ?? guessCategory(text, cats.map((c) => c.id));
  const cat = cats.find((c) => c.id === categoryId);
  if (!cat) return null;

  const { specs, rest } = readSpecs(text, cat);
  const own = new Set([cat.noun, cat.label].flatMap((w) => tokens(w ?? "")).flatMap((w) => [w, `${w}s`, w.replace(/s$/, "")]));
  return { categoryId: cat.id, specs, left: tokens(rest).filter((w) => !own.has(w)) };
}

// The category's field values found in a piece of text (a BOM part's name, for auto-link).
export const parseSpecs = (text: string, cat: InvCategory) => readSpecs(text, cat).specs;

function readSpecs(text: string, cat: InvCategory) {
  let words = tokens(text);
  const specs: Record<string, string> = {};
  for (const f of cat.fields) {
    if (f.hidden || (f.kind !== "options" && f.kind !== "material")) continue;
    const hit = pickOption(fieldChoices(f), words);
    if (!hit) continue;
    specs[f.id] = hit.value;
    words = words.filter((w) => !hit.used.includes(w));
  }
  let rest = ` ${words.join(" ")} `;
  for (const f of cat.fields) {
    if (f.hidden || f.kind !== "number" || !f.name || !f.name.includes("{}")) continue;
    const [before, after] = f.name.split("{}").map((s) => tokens(s).map(escape).join("\\s*"));
    const m = new RegExp(`\\s${before ? `${before}\\s*` : ""}(\\d+(?:\\.\\d+)?)${after ? `\\s*${after}` : ""}\\s`).exec(rest);
    if (!m || (!before && !after)) continue;
    specs[f.id] = m[1];
    rest = rest.replace(m[0], " ");
  }
  return { specs, rest };
}
