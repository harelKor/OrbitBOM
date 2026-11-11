// What the vision model is told about our inventory, and how its answer is turned into our words
// (plan/item-recognition.md). Plain text work, tested on its own; the call is in gemini.ts.

import { activeFields, fieldChoices, type InvCategory } from "@/lib/inventory/categories";
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
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#/.]+/g, "");

// The model's answer in our words: only our category ids, only fields the category has, option
// values in our spelling (or dropped), then what parseQuick reads from the text fills the gaps,
// then the phone's tooth count wins over anything else.
export function cleanAnswer(raw: ModelAnswer, cats: InvCategory[], phone: { teeth?: number | null } = {}): Recognized {
  const cat = cats.find((c) => c.id === raw.categoryId) ?? null;
  const specs: Record<string, string> = {};
  if (cat) {
    for (const { field, value } of raw.specs ?? []) {
      const f = cat.fields.find((x) => x.id === field);
      const v = String(value ?? "").trim();
      if (!f || !v) continue;
      const choices = fieldChoices(f);
      if (choices.length) {
        const hit = choices.find((c) => norm(c) === norm(v));
        if (hit) specs[f.id] = hit;
      } else if (f.kind === "number") {
        const n = /-?\d+(\.\d+)?/.exec(v)?.[0];
        if (n) specs[f.id] = n;
      } else specs[f.id] = v;
    }
    // What a person would type from the label, read like the add box reads typing.
    const text = [raw.product, raw.textSeen].filter(Boolean).join(" ");
    const quick = text ? parseQuick(text, [cat]) : null;
    if (quick?.categoryId === cat.id) for (const [k, v] of Object.entries(quick.specs)) specs[k] ??= v;
    const fields = activeFields(cat, specs);
    if (phone.teeth && fields.some((f) => f.id === "teeth")) specs.teeth = String(phone.teeth);
    else if (fields.some((f) => f.id === "teeth") && specs.teeth && !/\d+\s*t\b/i.test(raw.textSeen ?? "")) delete specs.teeth; // a guess, not printed
    // The phone's hex / round bore isn't filled in: without a scale it can't tell 1/2" from 3/8".
  }
  const clean = (s: string | undefined) => (s ?? "").trim() || null;
  const brand = clean(raw.brand);
  const product = clean(raw.product);
  return {
    categoryId: cat?.id ?? null,
    specs,
    name: product ? (brand && !product.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${product}` : product) : "",
    brand,
    partNumber: clean(raw.partNumber),
    searchQuery: clean(raw.searchQuery) ?? (product ? [brand, product].filter(Boolean).join(" ") : null),
    textSeen: (raw.textSeen ?? "").trim(),
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
    alternatives: (raw.alternatives ?? []).filter((a) => cats.some((c) => c.id === a.categoryId)).slice(0, 3),
  };
}
