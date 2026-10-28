// Inventory spreadsheet import (ref §5): the member maps columns, checks a preview, imports.
// Groups written "Raw stock > Tube" become a sub-group; unknown groups, locations and
// conditions are created. A row whose name and category match an item already on the shelf
// updates that item, so a file from "Export spreadsheet" imports back without duplicates.

import { parseStock } from "./stock";

export const IMPORT_COLUMNS = [
  { id: "item", label: "Item", required: true },
  { id: "spec", label: "Size / spec" },
  { id: "quantity", label: "Quantity" },
  { id: "location", label: "Location" },
  { id: "category", label: "Category (group)" },
  { id: "condition", label: "Condition" },
  { id: "material", label: "Material" },
  { id: "seasonNeed", label: "Needed for Season" },
  { id: "price", label: "Price ($)" },
  { id: "url", label: "Product URL" },
  { id: "note", label: "Notes" },
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number]["id"];
export type ColumnMap = Partial<Record<ImportColumn, number>>; // column index per field

// A field left blank (or not mapped) is null: a new item leaves it empty, an existing one keeps it.
export type ImportRow = {
  name: string;
  inStock: number | null;
  location: string | null;
  groupPath: string[];
  condition: string | null;
  material: string | null;
  seasonNeed: number | null;
  price: number | null;
  url: string | null;
  note: string | null;
};

const cell = (row: unknown[], i: number | undefined) =>
  i === undefined || row[i] == null ? "" : String(row[i]).trim();

// Guess the mapping from the header row (the FRCBOM template's headers match exactly).
export function guessColumns(header: unknown[]): ColumnMap {
  const map: ColumnMap = {};
  const names = header.map((h) => String(h ?? "").trim().toLowerCase());
  // The first word wins: an exact header, then one that starts with it.
  const find = (...words: string[]) => {
    for (const w of words) {
      const i = names.indexOf(w);
      if (i >= 0) return i;
    }
    for (const w of words) {
      const i = names.findIndex((n) => n.startsWith(w));
      if (i >= 0) return i;
    }
    return undefined;
  };
  map.item = find("item name", "item", "name", "part");
  map.spec = find("size", "spec");
  map.quantity = find("quantity", "qty", "in stock", "count");
  map.location = find("location", "shelf", "bin");
  map.category = find("category", "group");
  map.condition = find("condition");
  map.material = find("material");
  map.seasonNeed = find("needed for season", "season need", "needed");
  map.price = find("unit price", "price");
  map.url = find("product url", "url", "link");
  map.note = find("notes", "note");
  return map;
}

// A file from "Export spreadsheet": its Specs are already part of the item name.
export const isOrbitExport = (header: unknown[]) => {
  const names = header.map((h) => String(h ?? "").trim().toLowerCase());
  return names.includes("item name") && names.includes("specs");
};

// "3", "2 ¾" (a sheet); blank or unreadable is null.
const amount = (text: string) => (text ? parseStock(text, true) : null);

export function parseImportRows(rows: unknown[][], map: ColumnMap, specInName: boolean): ImportRow[] {
  const out: ImportRow[] = [];
  for (const row of rows) {
    const item = cell(row, map.item);
    if (!item) continue;
    const spec = cell(row, map.spec);
    const price = Number(cell(row, map.price).replace(/[$,₪\s]/g, ""));
    const url = cell(row, map.url);
    out.push({
      name: specInName && spec ? `${item} ${spec}` : item,
      inStock: amount(cell(row, map.quantity)),
      location: cell(row, map.location) || null,
      groupPath: cell(row, map.category)
        .split(">")
        .map((s) => s.trim())
        .filter(Boolean),
      condition: cell(row, map.condition) || null,
      material: cell(row, map.material) || null,
      seasonNeed: amount(cell(row, map.seasonNeed)),
      price: cell(row, map.price) && Number.isFinite(price) && price >= 0 ? price : null,
      url: /^https?:\/\//i.test(url) ? url : null,
      note: cell(row, map.note) || null,
    });
  }
  return out;
}

// Minimal CSV reader: quoted fields, doubled quotes, commas or semicolons.
export function parseCsv(text: string): string[][] {
  const delimiter = (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}
