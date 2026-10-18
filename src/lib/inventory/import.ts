// Inventory spreadsheet import (ref §5): the member maps columns, checks a preview, imports.
// Groups written "Raw stock > Tube" become a sub-group; unknown groups, locations and
// conditions are created.

export const IMPORT_COLUMNS = [
  { id: "item", label: "Item", required: true },
  { id: "spec", label: "Size / spec" },
  { id: "quantity", label: "Quantity" },
  { id: "location", label: "Location" },
  { id: "category", label: "Category (group)" },
  { id: "condition", label: "Condition" },
  { id: "material", label: "Material" },
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number]["id"];
export type ColumnMap = Partial<Record<ImportColumn, number>>; // column index per field

export type ImportRow = {
  name: string;
  inStock: number;
  location: string | null;
  groupPath: string[];
  condition: string | null;
  material: string | null;
};

const cell = (row: unknown[], i: number | undefined) =>
  i === undefined || row[i] == null ? "" : String(row[i]).trim();

// Guess the mapping from the header row (the FRCBOM template's headers match exactly).
export function guessColumns(header: unknown[]): ColumnMap {
  const map: ColumnMap = {};
  const names = header.map((h) => String(h ?? "").trim().toLowerCase());
  const find = (...words: string[]) => {
    const i = names.findIndex((n) => words.some((w) => n === w || n.startsWith(w)));
    return i >= 0 ? i : undefined;
  };
  map.item = find("item", "name", "part");
  map.spec = find("size", "spec");
  map.quantity = find("quantity", "qty", "in stock", "count");
  map.location = find("location", "shelf", "bin");
  map.category = find("category", "group");
  map.condition = find("condition");
  map.material = find("material");
  return map;
}

export function parseImportRows(rows: unknown[][], map: ColumnMap, specInName: boolean): ImportRow[] {
  const out: ImportRow[] = [];
  for (const row of rows) {
    const item = cell(row, map.item);
    if (!item) continue;
    const spec = cell(row, map.spec);
    const qty = Number(cell(row, map.quantity));
    out.push({
      name: specInName && spec ? `${item} ${spec}` : item,
      inStock: Number.isFinite(qty) && qty > 0 ? Math.round(qty) : 0,
      location: cell(row, map.location) || null,
      groupPath: cell(row, map.category)
        .split(">")
        .map((s) => s.trim())
        .filter(Boolean),
      condition: cell(row, map.condition) || null,
      material: cell(row, map.material) || null,
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
