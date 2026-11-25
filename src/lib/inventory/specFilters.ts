// A category page's spec filters: one labeled row of pills per field (Bearings: ID, OD,
// Thick, Type), each value once however it was typed ("8mm", "8 mm"), in a sensible order (inch
// sizes, then metric smallest first, then words), and only the values the other picks leave.
// Several values can be picked in a row (any of them) and across rows (all of them); a Raw Stock
// category's X and Y are one Size row of the pairs that exist, "500 × 300" (Harel, 2026-11-25).

import { activeFields, typeFieldOf, xyFieldsOf, type CategoryField, type InvCategory } from "./categories";

export type SpecPicks = Record<string, string[]>; // field id → the picked values' keys
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
// With two sub-types picked only the fields both have show.
function filterFields(cat: InvCategory, picks: SpecPicks): CategoryField[] {
  const type = typeFieldOf(cat);
  const typeKeys = type ? (picks[type.id] ?? []) : [];
  const typeValue = type && typeKeys.length === 1 ? ((type.options ?? []).find((o) => specKey(o) === typeKeys[0]) ?? "") : "";
  return activeFields(cat, type ? { [type.id]: typeValue } : {});
}

// The Size row of a Raw Stock X / Y pair: its id names both fields, so matching needs no category.
const XY_ID = "xy:";
const xyId = (x: CategoryField, y: CategoryField) => `${XY_ID}${x.id}:${y.id}`;
const xyOf = (id: string) => (id.startsWith(XY_ID) ? id.slice(XY_ID.length).split(":") : null);
const keyOf = (item: Specs, id: string) => {
  const xy = xyOf(id);
  if (!xy) return specKey(item.specs[id]);
  const [x, y] = xy.map((f) => specKey(item.specs[f]));
  return x && y ? `${x}x${y}` : "";
};

export const matchesPicks = (item: Specs, picks: SpecPicks, except?: string) =>
  Object.entries(picks).every(([id, keys]) => id === except || !keys.length || keys.includes(keyOf(item, id)));

// One group per field with at least two values among the items the other picks leave (or with a
// pick of its own, so it can be cleared). A field with too many values to scan is left out.
export function specGroups(cat: InvCategory, items: Specs[], picks: SpecPicks, max = 40): SpecGroup[] {
  const fields = filterFields(cat, picks);
  const xy = xyFieldsOf(cat, fields);
  return fields.flatMap((field) => {
    if (xy && field === xy.y) return [];
    const row: CategoryField = xy && field === xy.x ? { id: xyId(xy.x, xy.y), label: "Size", kind: "text" } : field;
    const seen = new Map<string, SpecValue & { at: number[] }>();
    for (const item of items) {
      const key = keyOf(item, row.id);
      if (!key || !matchesPicks(item, picks, row.id)) continue;
      const v = seen.get(key);
      if (v) v.count++;
      else if (row === field) seen.set(key, { key, label: pillLabel(field, item.specs[field.id]!), count: 1, at: [] });
      else {
        const [x, y] = [item.specs[xy!.x.id]!, item.specs[xy!.y.id]!];
        seen.set(key, { key, label: `${x.trim()} × ${y.trim()}`, count: 1, at: [parseFloat(x), parseFloat(y)] });
      }
    }
    // Sizes by X, then Y, smallest first.
    const values: SpecValue[] =
      row === field
        ? sortValues(field, [...seen.values()])
        : [...seen.values()].sort((a, b) => (a.at[0] || 0) - (b.at[0] || 0) || (a.at[1] || 0) - (b.at[1] || 0) || a.label.localeCompare(b.label));
    const picked = !!picks[row.id]?.length;
    if ((values.length < 2 && !picked) || values.length > max) return [];
    return [{ field: row, label: filterLabel(row), values: values.map(({ key, label, count }) => ({ key, label, count })) }];
  });
}

// Picks still valid for the category: a sub-type change drops the picks of fields it doesn't have.
export function keepPicks(cat: InvCategory, picks: SpecPicks): SpecPicks {
  const fields = filterFields(cat, picks);
  const xy = xyFieldsOf(cat, fields);
  const ids = new Set([...fields.map((f) => f.id), ...(xy ? [xyId(xy.x, xy.y)] : [])]);
  return Object.fromEntries(Object.entries(picks).filter(([id, keys]) => ids.has(id) && keys.length));
}

// A value picked or unpicked in a row: the others stay picked.
export function togglePickIn(picks: SpecPicks, id: string, key: string): SpecPicks {
  const keys = picks[id] ?? [];
  return { ...picks, [id]: keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key] };
}
