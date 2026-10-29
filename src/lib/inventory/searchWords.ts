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

// "8×16×5mm" and "8*16*5" find "8x16x5".
const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/["'׳״”]/g, "")
    .replace(/(\d)\s*[×*]\s*(?=\d)/g, "$1x")
    .replace(/(\d+(?:\.\d+)?x\d+(?:\.\d+)?x\d+(?:\.\d+)?)\s*mm\b/g, "$1");
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

// Every typed word must be found in the text, in either language.
export function matchesSearch(text: string, query: string): boolean {
  const t = clean(text);
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => searchAlternatives(word).some((alt) => t.includes(alt)));
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
