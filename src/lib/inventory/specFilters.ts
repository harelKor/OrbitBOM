// A category page's spec filters: one labeled row of pills per field (Bearings: Bore (ID), OD,
// Width, Type), each value once however it was typed ("8mm", "8 mm"), in a sensible order (inch
// sizes, then metric smallest first, then words), and only the values the other picks leave.

import { activeFields, typeFieldOf, type CategoryField, type InvCategory } from "./categories";

export type SpecPicks = Record<string, string>; // field id → the picked value's key
export type SpecValue = { key: string; label: string; count: number };
export type SpecGroup = { field: CategoryField; label: string; values: SpecValue[] };

type Specs = { specs: Record<string, string> };

// The same value however it was typed: no spaces, any case, no trailing ".0".
export const specKey = (v: string | undefined) =>
  (v ?? "")
    .replace(/\s+/g, "")
    .replace(/(\d)\.0+(?!\d)/g, "$1")
    .toLowerCase();

// "Width (mm)" → "Width"; other notes stay ("Bore (ID)").
export const filterLabel = (f: CategoryField) => f.label.replace(/\s*\((mm|m|in)\)\s*$/i, "").trim();

const isNumber = (v: string) => /^\d+(\.\d+)?$/.test(v.trim());
const unitOf = (f: CategoryField) => f.label.match(/\((mm|m)\)\s*$/i)?.[1] ?? "";

// How a value reads on its pill: a bare number gets its field's unit ("4" → "4mm", "36" → "36T").
function pillLabel(f: CategoryField, raw: string) {
  const v = raw.trim().replace(/\s+/g, " ");
  const option = (f.options ?? []).find((o) => specKey(o) === specKey(v));
  if (option) return option;
  if (!isNumber(v)) return v;
  if (f.id === "teeth") return `${v}T`;
  return `${v}${unitOf(f)}`;
}

const lead = (v: string) => {
  const m = v.match(/^(\d+)\s+(\d+)\/(\d+)/) ?? v.match(/^(\d+)\/(\d+)/);
  if (m && m.length === 4) return +m[1] + +m[2] / +m[3];
  if (m) return +m[1] / +m[2];
  const n = v.match(/^\d+(\.\d+)?/);
  return n ? parseFloat(n[0]) : NaN;
};
const isInch = (v: string) => /"|\binch\b/i.test(v);

// Inch sizes first (in the field's option order, else smallest first), then metric and other
// numbers smallest first, then words in option order, then the rest A-Z.
export function sortValues(f: CategoryField, values: SpecValue[]): SpecValue[] {
  const keys = (f.options ?? []).map(specKey);
  const at = (v: SpecValue) => {
    const i = keys.indexOf(v.key);
    return i < 0 ? Infinity : i;
  };
  const rank = (v: SpecValue) => (isInch(v.label) ? 0 : Number.isFinite(lead(v.label)) ? 1 : 2);
  return [...values].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    if (rank(a) === 1) return lead(a.label) - lead(b.label) || a.label.localeCompare(b.label);
    const o = at(a) - at(b);
    if (o && (at(a) !== Infinity || at(b) !== Infinity)) return o;
    if (rank(a) === 0) return lead(a.label) - lead(b.label) || a.label.localeCompare(b.label);
    return a.label.localeCompare(b.label);
  });
}

// The fields that can filter: not hidden, and (for conditional ones) fit for the picked sub-type.
// Without a picked sub-type only the fields every sub-type has show.
function filterFields(cat: InvCategory, picks: SpecPicks): CategoryField[] {
  const type = typeFieldOf(cat);
  const typeValue = type && picks[type.id] ? ((type.options ?? []).find((o) => specKey(o) === picks[type.id]) ?? "") : "";
  return activeFields(cat, type ? { [type.id]: typeValue } : {});
}

export const matchesPicks = (item: Specs, picks: SpecPicks, except?: string) =>
  Object.entries(picks).every(([id, key]) => id === except || specKey(item.specs[id]) === key);

// One group per field with at least two values among the items the other picks leave (or with a
// pick of its own, so it can be cleared). A field with too many values to scan is left out.
export function specGroups(cat: InvCategory, items: Specs[], picks: SpecPicks, max = 40): SpecGroup[] {
  return filterFields(cat, picks).flatMap((field) => {
    const seen = new Map<string, SpecValue>();
    for (const item of items) {
      const raw = item.specs[field.id];
      const key = specKey(raw);
      if (!key || !matchesPicks(item, picks, field.id)) continue;
      const v = seen.get(key);
      if (v) v.count++;
      else seen.set(key, { key, label: pillLabel(field, raw!), count: 1 });
    }
    const values = sortValues(field, [...seen.values()]);
    const picked = !!picks[field.id];
    if ((values.length < 2 && !picked) || values.length > max) return [];
    return [{ field, label: filterLabel(field), values }];
  });
}

// Picks still valid for the category: a sub-type change drops the picks of fields it doesn't have.
export function keepPicks(cat: InvCategory, picks: SpecPicks): SpecPicks {
  const ids = new Set(filterFields(cat, picks).map((f) => f.id));
  return Object.fromEntries(Object.entries(picks).filter(([id]) => ids.has(id)));
}
