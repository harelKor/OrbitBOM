import { fastenerKey, fastenerSearchWords } from "./fastener";

// The Inventory search box understands Hebrew and English shop words (Harel, 2026-10-27): a word
// from one of these lists also finds items named with any other word in it, so "מיסב" finds
// "Bearing 8×16×5mm" and "pulley" finds "פולי". Edit here; there is no settings UI.
const WORDS: string[][] = [
  ["gear", "גגש", "גלגל שיניים", "גלגלי שיניים"],
  ["pulley", "פולי", "פולים"],
  ["polycarbonate", "poly", "פולי", "לקסן"],
  ["belt", "רצועה", "רצועות"],
  ["bearing", "מיסב", "מיסבים"],
  ["wheel", "גלגל", "גלגלים"],
  ["sprocket", "ספרוקט", "ספרוקטים"],
  ["chain", "שרשרת", "שרשראות"],
  ["shaft", "ציר", "צירים"],
  ["screw", "bolt", "בורג", "ברגים", "ברגי"],
  ["rivet", "ניט", "ניטים"],
  ["drill", "מקדח", "מקדחים"],
  ["tap", "מברז", "מברזים"],
  ["wire", "cable", "כבל", "כבלים", "חוט"],
  ["fuse", "breaker", "פיוז", "פיוזים"],
  ["battery", "מצבר", "מצברים"],
  ["tube", "profile", "פרופיל", "פרופילים", "צינור", "צינורות"],
  ["plate", "sheet", "פלטה", "פלטות"],
  ["motor", "מנוע", "מנועים"],
  ["camera", "מצלמה", "מצלמות"],
  ["encoder", "אינקודר", "אנקודר"],
  ["gearbox", "planetary", "גיר", "גירבוקס"],
  ["glue", "דבק"],
  ["tape", "טייפ", "סלוטייפ"],
  ["filament", "פילמנט"],
  ["carbon", "קרבון"],
  ["end mill", "endmill", "כרסום"],
  ["insert", "סכין"],
  ["caliper", "קליבר"],
  ["pliers", "פלייר", "פלאייר"],
  ["wrench", "מפתח"],
  ["allen", "hex key", "אלן"],
  ["crimper", "קרימפר"],
  ["ferrule", "סופית", "סופיות"],
  ["connector", "קונקטור", "קונקטורים"],
  ["zip tie", "אזיקון", "אזיקונים"],
  ["servo", "סרבו"],
  ["epoxy", "אפוקסי"],
  ["electrical tape", "איזולירבנד", "בידוד"],
  ["heat shrink", "שרינק", "מכווץ"],
  ["ring terminal", "נעל", "נעלי"],
  ["solder", "בדיל", "הלחמה"],
  ["thick", "סמיך"],
  ["thin", "דליל"],
  ["minute", "דקות", "דקה"],
  ["flute", "פלוט", "פלוטים"],
  ["washer", "דסקית", "דסקיות"],
  ["nut", "אום", "אומים"],
  ["spacer", "ספייסר", "ספייסרים"],
];

// "8×16×5mm" and "8*16*5" find "8x16x5"; "M5x0.8 x 35", "M5 × 35mm" and "M5x35" are one key
// (fastener.ts), so "M5x35" finds "Socket button head screw M5x0.8 x 35" (audit, 2026-11-20).
const clean = (s: string) =>
  fastenerKey(
    s
      .toLowerCase()
      .replace(/["'׳״”]/g, "")
      .replace(/(\d)\s*[×*]\s*(?=\d)/g, "$1x")
      .replace(/(\d+(?:\.\d+)?x\d+(?:\.\d+)?x\d+(?:\.\d+)?)\s*mm\b/g, "$1"),
  );
const LISTS = WORDS.map((list) => list.map(clean));

// What one typed word may match in an item's text: the word itself, plus every word listed with
// it. Hebrew words also match their longer forms both ways: "ברג" and "גגשים" work too.
export function searchAlternatives(word: string): string[] {
  const w = clean(word);
  const out = new Set([w]);
  const hebrew = /[\u0590-\u05ff]/.test(w);
  for (const list of LISTS)
    if (
      list.some(
        (x) =>
          x === w ||
          (hebrew &&
            w.length >= 3 &&
            (x.startsWith(w) || (x.length >= 3 && w.startsWith(x)))),
      )
    )
      list.forEach((x) => out.add(x));
  return [...out];
}

// Letters and digits only: "Side plate" and "sideplate", "1691-26-501" and "169126501" meet.
const compact = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "");

// Every typed word must be found in the text, in either language, anywhere in it (the middle or
// end of a name too). Spaces, dashes and dots don't count, so "sideplate" finds "Side plate" and
// "26501" finds "1691-26-501"; failing that, the whole query run together may match (Harel,
// 2026-11-04).
// A screw's text also carries its head's words in both languages (fastener.ts): "button head"
// finds "M5×10 כיפה" and "גלילי" finds "Socket head cap screw M5x20", without editing items.
export function matchesSearch(text: string, query: string): boolean {
  const t = `${clean(text)} ${fastenerSearchWords(text)}`;
  const tc = compact(t);
  // The query is read whole first, so "M5 x 35" and "M5x0.8 x 35" are one word, "m5x35".
  const words = clean(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const each = words.every((word) =>
    searchAlternatives(word).some((alt) => {
      const a = compact(alt);
      return t.includes(alt) || (a.length > 0 && tc.includes(a));
    }),
  );
  if (each) return true;
  const whole = compact(clean(query));
  return words.length > 1 && whole.length >= 3 && tc.includes(whole);
}

// How well a text answers a query, for ordering results: the name starting with it first, then
// a word starting with it, then anywhere. 0 = no match.
export function searchRank(text: string, query: string): number {
  if (!matchesSearch(text, query)) return 0;
  const t = clean(text);
  const q = clean(query.trim());
  if (t.startsWith(q) || compact(t).startsWith(compact(q))) return 3;
  if (t.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q.split(/\s+/)[0]))) return 2;
  return 1;
}

// Store searches are in English (Harel, 2026-10-28): a Hebrew or mixed query is turned into
// English shop words first. Whole phrases come before single words; numbers and English words
// are kept. Edit here.
const PHRASES: [string, string][] = [
  ["דבק מהיר", "ca glue"],
  ["דבק קרטון", "hot glue"],
  ["דבק חם", "hot glue"],
  ["נעל כבל", "ring terminal"],
  ["מפתח אלן", "hex key"],
  ["פלוט אחד", "single flute"],
  ["שני פלוטים", "2 flute"],
  ["חוט סיליקון", "silicone wire"],
  ["כבל סיליקון", "silicone wire"],
  ["גלגל שיניים", "gear"],
];

const hebrew = (s: string) => /[\u0590-\u05ff]/.test(s);

// The English for a Hebrew query, or null when it has no Hebrew (or no word could be turned
// into English).
export function toEnglishQuery(query: string): string | null {
  let q = clean(query);
  if (!hebrew(q)) return null;
  for (const [he, en] of PHRASES) q = q.split(he).join(` ${en} `);
  const out: string[] = [];
  let unknown = 0;
  for (const word of q.split(/\s+/).filter(Boolean)) {
    if (!hebrew(word)) {
      out.push(word);
      continue;
    }
    const alts = searchAlternatives(word);
    const en = alts.find((a) => !hebrew(a));
    if (en) out.push(en);
    else unknown++;
  }
  const english = [...new Set(out)].join(" ").trim();
  // Only numbers left means the words themselves weren't understood.
  if (!english || !/[a-z]/.test(english)) return null;
  return unknown > out.length ? null : english;
}
