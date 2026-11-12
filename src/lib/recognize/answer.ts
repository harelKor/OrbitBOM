// What the vision model is told about our inventory, and how its answer is turned into our words
// (plan/item-recognition.md). Plain text work, tested on its own; the call is in gemini.ts.

import { fieldChoices, type InvCategory } from "@/lib/inventory/categories";
import { parseQuick } from "@/lib/inventory/quick";

// The model's answer, as the JSON schema in gemini.ts asks for it.
export type ModelAnswer = {
  categoryId: string;
  specs: { field: string; value: string }[];
  brand: string;
  product: string;
  partNumber: string;
  searchQuery: string;
  textSeen: string;
  confidence: number;
  alternatives: { categoryId: string; product: string }[];
};

// Our categories and their fields in a few lines each, so the model answers with our ids and
// our option spellings ("HTD 5mm", not "5 mm HTD").
export function catalogText(cats: InvCategory[]): string {
  return cats
    .map((c) => {
      const fields = c.fields
        .filter((f) => !f.hidden)
        .map((f) => {
          const choices = fieldChoices(f);
          const when = f.when ? ` (only when ${c.fields[0]?.id} is ${[f.when].flat().join(" or ")})` : "";
          return `  - ${f.id} "${f.label}" ${choices.length ? `one of: ${choices.slice(0, 40).join(" | ")}` : f.kind}${when}`;
        });
      return [`${c.id}: ${c.label}`, ...fields].join("\n");
    })
    .join("\n");
}

export function prompt(cats: InvCategory[]): string {
  return [
    "You identify parts and supplies for an FRC robotics team's inventory from one phone photo.",
    "Pick the category id that fits best from the list below and fill the fields you can see or know for sure.",
    "For an options field use one of its listed values exactly; for number fields give just the number.",
    "Read every label, part number, brand and marking in the photo into textSeen.",
    "If it is a known product (motor, motor controller, sensor, encoder, battery, gearbox, tool, glue...), give brand and product name, and a short searchQuery to find it in an FRC store (e.g. 'Kraken X60', 'CANcoder', 'Loctite 243').",
    "Do NOT count gear, pulley or sprocket teeth from the photo: leave the teeth field out unless the number is printed on the part.",
    "confidence is 0..1 for the category and product together. If unsure, list up to 3 alternatives.",
    "Categories:",
    catalogText(cats),
  ].join("\n");
}

export type Recognized = {
  categoryId: string | null;
  specs: Record<string, string>;
  name: string; // the product's own name, when it's a known product
  brand: string | null;
  partNumber: string | null;
  searchQuery: string | null;
  textSeen: string;
  confidence: number;
  alternatives: { categoryId: string; product: string }[];
  toothed: boolean; // a gear, pulley or sprocket
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#/.]+/g, "");

// The model's answer in our words: only our category ids, only fields the category has, option
// values in our spelling (or dropped), then what parseQuick reads from the text fills the gaps.
// Gears, pulleys and sprockets (a teeth field) take only what is printed on the part: the model
// guessed DP, bore and pitch from the look (Harel, 2026-11-12). Their teeth: a printed count
// ("36T"), else the phone's own count, never the model's guess. Their name builds from the fields.
export function cleanAnswer(raw: ModelAnswer, cats: InvCategory[], phone: { teeth?: number | null } = {}): Recognized {
  const cat = cats.find((c) => c.id === raw.categoryId) ?? null;
  const toothed = !!cat?.fields.some((f) => f.id === "teeth");
  const seen = raw.textSeen ?? "";
  const printed = (v: string) => !!norm(v) && norm(seen).includes(norm(v));
  const specs: Record<string, string> = {};
  if (cat) {
    for (const { field, value } of raw.specs ?? []) {
      const f = cat.fields.find((x) => x.id === field);
      const v = String(value ?? "").trim();
      if (!f || !v || (toothed && f.id === "teeth")) continue;
      let out: string | undefined;
      const choices = fieldChoices(f);
      if (choices.length) out = choices.find((c) => norm(c) === norm(v));
      else if (f.kind === "number") out = /-?\d+(\.\d+)?/.exec(v)?.[0];
      else out = v;
      if (out && (!toothed || printed(out) || printed(v))) specs[f.id] = out;
    }
    // What a person would type from the label, read like the add box reads typing. For a toothed
    // part only the text on it, not the model's product name.
    const text = toothed ? seen : [raw.product, seen].filter(Boolean).join(" ");
    const quick = text ? parseQuick(text, [cat]) : null;
    if (quick?.categoryId === cat.id) for (const [k, v] of Object.entries(quick.specs)) if (k !== "teeth") specs[k] ??= v;
    if (toothed) {
      const onPart = /\b(\d{1,3})\s*T\b/i.exec(seen)?.[1];
      const teeth = onPart ?? (phone.teeth ? String(phone.teeth) : null);
      if (teeth) specs.teeth = teeth;
    }
  }
  const clean = (s: string | undefined) => (s ?? "").trim() || null;
  const brand = clean(raw.brand);
  const product = clean(raw.product);
  return {
    categoryId: cat?.id ?? null,
    specs,
    name: product && !toothed ? (brand && !product.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${product}` : product) : "",
    brand,
    partNumber: clean(raw.partNumber),
    // A gear's search finds any gear: the stores are asked only about a named product.
    searchQuery: toothed ? null : (clean(raw.searchQuery) ?? (product ? [brand, product].filter(Boolean).join(" ") : null)),
    toothed,
    textSeen: (raw.textSeen ?? "").trim(),
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
    alternatives: (raw.alternatives ?? []).filter((a) => cats.some((c) => c.id === a.categoryId)).slice(0, 3),
  };
}
