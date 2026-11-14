// A material's density in g/cm³, from its name: Onshape's material ("Aluminum - 6061"), the
// part's inventory material ("6061 Aluminum Plate 1/4\"") or a base material. First match wins,
// so the more specific names come first (stainless before steel, 7075 before aluminium).
const TABLE: [RegExp, number][] = [
  [/7075/, 2.81],
  [/alumin|\b6061\b|\b5052\b|\b6063\b|\b2024\b/, 2.7],
  [/stainless|\b30[34]\b|\b316\b/, 8.0],
  [/steel|chromoly|\b4130\b|\b4140\b|\b1018\b/, 7.85],
  [/brass/, 8.5],
  [/bronze/, 8.8],
  [/copper/, 8.96],
  [/titanium/, 4.43],
  [/polycarb|lexan|\bpc\b/, 1.2],
  [/acrylic|plexi|pmma/, 1.18],
  [/carbon/, 1.6],
  [/delrin|acetal|\bpom\b/, 1.41],
  [/onyx/, 1.2],
  [/nylon|\bpa\s?6|\bpa\s?12|\bpa612\b/, 1.14],
  [/petg/, 1.27],
  [/\bpla\b/, 1.24],
  [/\babs\b/, 1.05],
  [/\basa\b/, 1.07],
  [/\btpu\b/, 1.21],
  [/hdpe/, 0.96],
  [/uhmw/, 0.93],
  [/srpp|polypropylene/, 0.9],
  [/g-?10|fr-?4|garolite/, 1.85],
  [/birch|plywood/, 0.68],
  [/\bmdf\b/, 0.75],
  [/wood/, 0.6],
  [/rubber|neoprene|silicone|urethane/, 1.2],
  [/foam/, 0.05],
];

export function densityOf(...names: (string | null | undefined)[]): number | null {
  for (const name of names) {
    if (!name) continue;
    const n = name.toLowerCase();
    for (const [re, d] of TABLE) if (re.test(n)) return d;
  }
  return null;
}

// A printed part is mostly walls with some infill: about this share of solid plastic. A rough
// number on purpose; a part whose weight matters gets its weight set by hand.
export const PRINTED_SHARE = 0.6;
export const GUESS_DENSITY = 2.7; // no material known: counted as aluminium, and listed to check
// A printed part with no known material: printed in plastic (PLA's density), not aluminium,
// which weighed it about 3.6 times too heavy (audit 2026-11-14). Still listed to check.
export const PRINTED_GUESS_DENSITY = 1.24;
