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
  ["endmill", "end mill", "כרסום"],
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
];

const clean = (s: string) => s.toLowerCase().replace(/["'׳״”]/g, "");
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
