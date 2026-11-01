// Inventory categories as the pages use them: their fields, the name an item's values build, the
// short spec line on a card, and checks on values coming from a form or an AI.

import { MATERIALS } from "@/config/materials";
import { guessCategory, type CategoryGroupId } from "@/config/inventory";
import type { CategoryField } from "@/db/schema";

export type { CategoryField };
export type InvCategory = {
  id: string;
  label: string;
  noun: string;
  group: CategoryGroupId;
  sheet: boolean;
  image: string | null; // its picture: a public/categories/ path ("/categories/gears.png") or an R2 key
  imageUrl?: string | null; // a short-lived link to it, filled for pages
  defaultLocationId: string | null;
  fields: CategoryField[];
};

export const getCategory = (cats: InvCategory[], id: string | null | undefined) => (id ? cats.find((c) => c.id === id) : undefined);

// An item's category: the one set on it, else a guess from its name, else Other (or the last one).
export function categoryOf(item: { category: string | null; name: string }, cats: InvCategory[]): string {
  if (item.category && getCategory(cats, item.category)) return item.category;
  const ids = cats.map((c) => c.id);
  return guessCategory(item.name, ids) ?? (ids.includes("other") ? "other" : (ids.at(-1) ?? "other"));
}

// The choices a field offers: its options, or for a material field the base materials filled in
// when categories are read (listCategories).
export function fieldChoices(field: CategoryField): string[] {
  if (field.kind === "options") return field.options ?? [];
  if (field.kind === "material")
    return field.materialChoices ?? (field.options?.length ? field.options : (field.materials ?? []).flatMap((g) => MATERIALS[g] ?? []));
  return [];
}

// A field with `when` applies only while the category's first field (its sub-type, like Glue or
// Tape) holds one of those values.
const whenOf = (f: CategoryField) => (f.when == null ? [] : Array.isArray(f.when) ? f.when : [f.when]);
const applies = (cat: InvCategory, f: CategoryField, specs: Record<string, string>) => {
  const when = whenOf(f);
  return !when.length || when.includes(specs[cat.fields[0]?.id] ?? "");
};

// The fields an item of this category shows for its values: not hidden, and fit for its sub-type.
export const activeFields = (cat: InvCategory, specs: Record<string, string>) =>
  cat.fields.filter((f) => !f.hidden && applies(cat, f, specs));

// The category's sub-type field: a first options field that other fields depend on.
export const typeFieldOf = (cat: InvCategory | undefined) => {
  const first = cat?.fields[0];
  return first?.kind === "options" && cat!.fields.some((f) => whenOf(f).length) ? first : undefined;
};

// The values without those of conditional fields the current sub-type doesn't have (after the
// sub-type changes).
export function dropInactive(cat: InvCategory, specs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(specs).filter(([id]) => {
      const f = cat.fields.find((x) => x.id === id);
      return !f || applies(cat, f, specs);
    }),
  );
}

const plain = (v: string) => v.replace(/\s*\([^)]*\)/g, "").trim();

// A bearing's size as ID x OD x Thick: "8x16x5", "0.6\"x1.2\"x0.2\"", or spaced when a value has a
// space ("3/4\" x 1 3/8\" x 0.43\""). Empty unless all three are set (Harel, 2026-10-29).
export function bearingSize(specs: Record<string, string>): string {
  const dims = [specs.bore, specs.od, specs.width].map((v) =>
    (v ?? "")
      .trim()
      .replace(/\s+Round$/i, "")
      .replace(/^(\d+(?:\.\d+)?)\s*mm$/i, "$1"),
  );
  if (dims.some((d) => !d)) return "";
  return dims.join(dims.some((d) => d.includes(" ")) ? " x " : "x");
}

const bare = (v: string | undefined) => (v ?? "").trim().replace(/\s*mm$/i, "");

// Sizes that read as one word (Harel, 2026-10-30): a round tube's OD x wall ("25x2", or "Ø25" with
// no wall), a block's X x Y x Z ("50x50x100"), a cylinder's OD x length ("Ø30x150"). Empty when
// the category has none or its values are missing.
export function stockSize(cat: InvCategory, specs: Record<string, string>): string {
  const [od, wall, length] = [bare(specs.od), bare(specs.wall), bare(specs.length)];
  if (cat.id === "round-tubes") return od ? (wall ? `${od}x${wall}` : `Ø${od}`) : "";
  if (cat.id !== "cylinders-blocks") return "";
  if (specs.shape === "Block") {
    const dims = [specs.x, specs.y, specs.z].map(bare);
    return dims.every(Boolean) ? dims.join("x") : "";
  }
  if (specs.shape === "Cylinder" && od) return length ? `Ø${od}x${length}` : `Ø${od}`;
  return "";
}

// "Aluminum 25x2 tube", "Brass Ø30 cylinder", "Aluminum 50x50x100 block". A cylinder's length
// stays out of the name like every raw stock length (it lives in specs and pieces).
function stockName(cat: InvCategory, specs: Record<string, string>): string {
  const material = specs.material?.trim() ?? "";
  if (cat.id === "round-tubes") {
    const size = stockSize(cat, specs);
    return size ? [material, size, "tube"].filter(Boolean).join(" ") : "";
  }
  if (cat.id === "cylinders-blocks" && (specs.shape === "Block" || specs.shape === "Cylinder"))
    return [material, stockSize(cat, { ...specs, length: "" }), specs.shape.toLowerCase()].filter(Boolean).join(" ");
  return "";
}

// Raw Stock names never carry a stock length or a sheet's size (Harel, 2026-10-30): those stay in
// specs and pieces, so one item holds every length or offcut of a stock. A box tube's size is its
// profile (25x50), so it stays.
export const leftOutOfName = (cat: InvCategory, f: CategoryField) =>
  cat.group === "consumables" && (f.id === "length" || (f.id === "size" && cat.id !== "square-tubes"));

// Every box tube is aluminium (Harel, 2026-11-01), so plain "Aluminum" stays out of its name:
// "25x50mm 2mm wall Box tube". Another material (carbon, an alloy like 6061-T6) is still named.
const unnamedMaterial = (cat: InvCategory, f: CategoryField, v: string) =>
  cat.id === "square-tubes" && f.id === "material" && /^(alumin?i?um|אלומיניום)$/i.test(v);

// A field's name template when it has none: the value, after a space.
export const DEFAULT_NAME = " {}";

// "36T HTD 5mm 9mm wide 1/2" Hex Pulley": each value through its field's `name`, then the noun.
// Templates carry their own spacing (Harel, 2026-10-30): " {}mm" puts a space before the value,
// "x{}" or "{}mm" sticks to the previous value ("25x50" + "x2" → "25x50x2"). A sub-type ("M5 Tap")
// goes last like a noun, and neither repeats a word the name already has.
export function buildName(cat: InvCategory, specs: Record<string, string>): string {
  const size = cat.id === "bearings" ? bearingSize(specs) : "";
  if (size) return [size, specs.flanged === "Flanged" ? "Flanged" : "", cat.noun].filter(Boolean).join(" ");
  const stock = stockName(cat, specs);
  if (stock) return stock;
  const type = typeFieldOf(cat);
  let name = "";
  for (const f of activeFields(cat, specs)) {
    const v = specs[f.id]?.trim();
    if (!v || f === type || leftOutOfName(cat, f) || unnamedMaterial(cat, f, v)) continue;
    // An inch value ('1x1"', '1/8"') drops the template's "mm": '1x1" 1/8" wall Box tube'.
    const template = v.endsWith('"') ? (f.name ?? DEFAULT_NAME).replace("{}mm", "{}") : (f.name ?? DEFAULT_NAME);
    name += template.replace("{}", v);
  }
  if (!name.trim()) return "";
  const has = (word: string) => name.toLowerCase().includes(word.toLowerCase());
  const typeWord = type ? plain(specs[type.id] ?? "") : "";
  if (typeWord && !has(typeWord)) name += ` ${typeWord}`;
  if (cat.noun && !has(cat.noun)) name += ` ${cat.noun}`;
  return name.replace(/\s+/g, " ").trim();
}

// The values in one short line for a card: "36T · HTD 5mm · 1/2" Hex".
export function specLine(cat: InvCategory | undefined, specs: Record<string, string>): string {
  if (!cat) return Object.values(specs).filter(Boolean).join(" · ");
  const size = cat.id === "bearings" ? bearingSize(specs) : "";
  if (size) return [size, specs.flanged].filter(Boolean).join(" · ");
  const stock = stockSize(cat, specs);
  if (cat.id === "round-tubes" && stock) return [specs.material, stock, bare(specs.length) && `${bare(specs.length)}mm`].filter(Boolean).join(" · ");
  if (cat.id === "cylinders-blocks" && stock) return [specs.shape, specs.material, stock].filter(Boolean).join(" · ");
  return activeFields(cat, specs)
    .filter((f) => specs[f.id])
    .map((f) => (f.id === "teeth" ? `${specs[f.id]}T` : specs[f.id]))
    .join(" · ");
}

// Options that include bare sizes (bearing IDs "8", "10") take any other size too ("11").
export const isSize = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());
export const takesSizes = (choices: string[]) => choices.some(isSize);

// Keeps only the category's own fields; a field with choices takes one of them (case-insensitive,
// stored with the option's own spelling), or another size when its options are sizes. Field ids
// or labels both work as keys.
export function checkSpecs(cat: InvCategory, specs: Record<string, unknown>): { values: Record<string, string> } | { error: string } {
  const values: Record<string, string> = {};
  for (const [key, raw] of Object.entries(specs)) {
    // Labels can repeat across sub-types ("Kind" of glue, "Kind" of tape): the sub-type's own first.
    const byLabel = (f: CategoryField) => f.label.toLowerCase() === key.toLowerCase();
    const field =
      cat.fields.find((f) => f.id === key) ??
      cat.fields.find((f) => byLabel(f) && applies(cat, f, specs as Record<string, string>)) ??
      cat.fields.find(byLabel);
    if (!field) return { error: `${cat.label} has no field "${key}". Its fields: ${cat.fields.map((f) => f.id).join(", ") || "none"}.` };
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const choices = fieldChoices(field);
    if (choices.length) {
      const hit = choices.find((c) => c.toLowerCase() === value.toLowerCase()) ?? (takesSizes(choices) && isSize(value) ? value : undefined);
      if (!hit) return { error: `${cat.label} ${field.label} is one of: ${choices.join(", ")}.` };
      values[field.id] = hit;
    } else if (field.kind === "number" && !/^\d+(\.\d+)?$/.test(value)) {
      return { error: `${cat.label} ${field.label} is a number.` };
    } else values[field.id] = value;
  }
  return { values };
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "category";
