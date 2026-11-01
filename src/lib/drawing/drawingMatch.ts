// Which Onshape drawing tab is a part's drawing (Sync Onshape drawings, Find drawing). Tab names
// carry extra words around the part number ("1691-26-431-05A Drawing", "Drawing - 1690-26-411-01A"),
// so the team's part code is matched first, wherever it sits in either name; parts without a code
// fall back to their name with the noise words taken out.

// "1690-26-411-01A", "1691-26-431-13A", "1691-26-431". A trailing segment needs a digit, so a word
// glued on with a hyphen ("1691-26-431-05A-Drawing") isn't read as part of the code.
const PART_CODE_RE = /(?<![\p{L}\p{N}])(\d{3,4}-\d{2}-\d{3}(?:-(?=[\p{L}\p{N}]*\d)[\p{L}\p{N}]+)*)(?![\p{L}\p{N}])/giu;

export function extractPartCodes(name: string): string[] {
  return [...name.matchAll(PART_CODE_RE)].map((m) => m[1].toUpperCase());
}

// Hebrew letters aren't \w, so word edges are spelled out instead of \b.
const NOISE = /(?<![\p{L}\p{N}])(drawing|drawings|dwg|sheet|rev\s*[\p{L}\p{N}]*|שרטוט|שירטוט)(?![\p{L}\p{N}])/giu;

export function cleanName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.(pdf|dwg|dxf|png|jpe?g|svg|step|stp)$/i, "")
    .replace(NOISE, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export type Tab = { name: string };

// The best tab for a part, given its names (name, Onshape name, part number): the same code, then
// a tab whose code the part's code starts with ("1691-26-431" for 1691-26-431-05A); for a part
// with no code, the same cleaned name, then one cleaned name inside the other (whole words, 4+
// letters). Null when nothing fits.
export function matchDrawingTab<T extends Tab>(partNames: (string | null | undefined)[], tabs: T[]): T | null {
  const names = partNames.filter((n): n is string => !!n?.trim());
  const codes = new Set(names.flatMap(extractPartCodes));
  if (codes.size) {
    const tabCodes = tabs.map((t) => extractPartCodes(t.name));
    const exact = tabs.find((_, i) => tabCodes[i].some((c) => codes.has(c)));
    if (exact) return exact;
    const prefix = tabs.find((_, i) => tabCodes[i].some((c) => [...codes].some((p) => p.startsWith(`${c}-`))));
    return prefix ?? null;
  }
  const cleaned = [...new Set(names.map(cleanName).filter(Boolean))];
  if (!cleaned.length) return null;
  const tabNames = tabs.map((t) => cleanName(t.name));
  const same = tabs.find((_, i) => tabNames[i] && cleaned.includes(tabNames[i]));
  if (same) return same;
  const within = (a: string, b: string) => a.length >= 4 && ` ${b} `.includes(` ${a} `);
  return tabs.find((_, i) => tabNames[i] && cleaned.some((n) => within(n, tabNames[i]) || within(tabNames[i], n))) ?? null;
}
