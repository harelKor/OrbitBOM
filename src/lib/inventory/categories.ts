// Inventory categories as the pages use them: their fields, the name an item's values build, the
// short spec line on a card, and checks on values coming from a form or an AI.

import { MATERIALS } from "@/config/materials";
import { guessCategory } from "@/config/inventory";
import type { CategoryField } from "@/db/schema";

export type { CategoryField };
export type InvCategory = {
  id: string;
  label: string;
  noun: string;
  sheet: boolean;
  image: string | null; // R2 key of its picture
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

// The choices a field offers: its options, or the BOM materials of its groups.
export function fieldChoices(field: CategoryField): string[] {
  if (field.kind === "options") return field.options ?? [];
  if (field.kind === "material") return (field.materials ?? []).flatMap((g) => MATERIALS[g] ?? []);
  return [];
}

const shown = (cat: InvCategory) => cat.fields.filter((f) => !f.hidden);

// "36T HTD 5mm 9mm wide 1/2" Hex Pulley": each value through its field's `name`, then the noun.
export function buildName(cat: InvCategory, specs: Record<string, string>): string {
  const parts = shown(cat).flatMap((f) => {
    const v = specs[f.id]?.trim();
    if (!v) return [];
    const pattern = f.name ?? "{}";
    return pattern ? [pattern.replace("{}", v)] : [];
  });
  if (!parts.length) return "";
  return [...parts, cat.noun].join(" ").replace(/\s+/g, " ").trim();
}

// The values in one short line for a card: "36T · HTD 5mm · 1/2" Hex".
export function specLine(cat: InvCategory | undefined, specs: Record<string, string>): string {
  if (!cat) return Object.values(specs).filter(Boolean).join(" · ");
  return cat.fields
    .filter((f) => specs[f.id])
    .map((f) => (f.id === "teeth" ? `${specs[f.id]}T` : specs[f.id]))
    .join(" · ");
}

// Keeps only the category's own fields; a field with choices takes one of them (case-insensitive,
// stored with the option's own spelling). Field ids or labels both work as keys.
export function checkSpecs(cat: InvCategory, specs: Record<string, unknown>): { values: Record<string, string> } | { error: string } {
  const values: Record<string, string> = {};
  for (const [key, raw] of Object.entries(specs)) {
    const field = cat.fields.find((f) => f.id === key || f.label.toLowerCase() === key.toLowerCase());
    if (!field) return { error: `${cat.label} has no field "${key}". Its fields: ${cat.fields.map((f) => f.id).join(", ") || "none"}.` };
    const value = String(raw ?? "").trim();
    if (!value) continue;
    const choices = fieldChoices(field);
    if (choices.length) {
      const hit = choices.find((c) => c.toLowerCase() === value.toLowerCase());
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
