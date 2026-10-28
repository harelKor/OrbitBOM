// "Export spreadsheet": the whole inventory as an .xlsx built in the browser, with no library.
// Sheet 1 is everything (Group → Category → Name); then one sheet per category group. The
// headers are ones guessColumns (import.ts) recognises, so a file exported here imports back.

import type { Condition, InvCategory, Item, Location } from "@/components/inventory/types";
import { CATEGORY_GROUPS, groupOf } from "@/config/inventory";
import { getCategory, specLine } from "@/lib/inventory/categories";
import { missing, standing } from "@/lib/inventory/season";
import { formatStock } from "@/lib/inventory/stock";

export const EXPORT_HEADERS = [
  "Group",
  "Category",
  "Item Name",
  "Specs",
  "In Stock",
  "Needed for Season",
  "Robots Need",
  "Missing / Short",
  "Standing",
  "Condition",
  "Location",
  "Unit Price ($)",
  "Vendor",
  "Product URL",
  "Notes",
] as const;

type Cell = string | number | null;
type Sheet = { name: string; rows: Cell[][] };

const STANDING = { ok: "OK", ordered: "Ordered", short: "Short" } as const;

// A stock amount: a plain number when whole (Excel can sum it), "2 ¾" for a part sheet.
const amount = (n: number | null, sheet: boolean): Cell => {
  if (n == null) return null;
  const text = formatStock(n, sheet);
  return /^\d+$/.test(text) ? Number(text) : text;
};

export function inventoryWorkbook(
  items: Item[],
  lookups: { categories: InvCategory[]; conditions: Condition[]; locations: Location[] },
  locationOf: (i: Item) => string | null,
): Uint8Array {
  const { categories, conditions, locations } = lookups;
  const groupLabel = new Map<string, string>(CATEGORY_GROUPS.map((g) => [g.id, g.label]));
  const groupRank = new Map<string, number>(CATEGORY_GROUPS.map((g, i) => [g.id, i]));
  const catRank = new Map(categories.map((c, i) => [c.id, i]));
  const conditionLabel = new Map(conditions.map((c) => [c.id, c.label]));
  const locationName = new Map(locations.map((l) => [l.id, l.name]));

  const rows = items.map((i) => {
    const cat = getCategory(categories, i.category);
    const group = groupOf(cat?.group);
    const link = i.cotsLinks[0];
    const row: Cell[] = [
      groupLabel.get(group) ?? group,
      cat?.label ?? i.category,
      i.name,
      specLine(cat, i.specs) || null,
      amount(i.inStock, i.sheet),
      amount(i.seasonNeed, i.sheet),
      i.usage?.need ? i.usage.need : null,
      missing(i, "any") || null,
      STANDING[standing(i, "any")],
      conditionLabel.get(i.conditionId ?? "") ?? null,
      locationName.get(locationOf(i) ?? "") ?? null,
      i.price,
      link ? (link.site ?? null) : null,
      link?.url ?? null,
      i.note,
    ];
    return { group, cat: catRank.get(i.category) ?? 1e9, name: i.name, row };
  });
  rows.sort(
    (a, b) =>
      (groupRank.get(a.group) ?? 99) - (groupRank.get(b.group) ?? 99) ||
      a.cat - b.cat ||
      a.name.localeCompare(b.name),
  );

  const header = [...EXPORT_HEADERS] as Cell[];
  const sheets: Sheet[] = [{ name: "All Inventory", rows: [header, ...rows.map((r) => r.row)] }];
  for (const g of CATEGORY_GROUPS) {
    const mine = rows.filter((r) => r.group === g.id);
    if (mine.length) sheets.push({ name: g.label, rows: [header, ...mine.map((r) => r.row)] });
  }
  return buildXlsx(sheets);
}

export function downloadInventory(...args: Parameters<typeof inventoryWorkbook>) {
  const bytes = inventoryWorkbook(...args);
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `OrbitParts_Inventory_${new Date().toLocaleDateString("en-CA")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------- A minimal .xlsx: inline strings, bold frozen header, filter, sized columns ----------

const esc = (s: string) =>
  s
    // Characters XML 1.0 can't hold.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const colName = (i: number) => {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

function sheetXml(rows: Cell[][]) {
  const cols = rows[0]?.length ?? 0;
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.min(60, Math.max(8, ...rows.map((r) => String(r[c] ?? "").length + 2))),
  );
  const body = rows
    .map((r, y) => {
      const cells = r
        .map((v, x) => {
          if (v == null || v === "") return "";
          const ref = `${colName(x)}${y + 1}`;
          const style = y === 0 ? ' s="1"' : "";
          return typeof v === "number"
            ? `<c r="${ref}"${style}><v>${v}</v></c>`
            : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${y + 1}">${cells}</row>`;
    })
    .join("");
  const last = `${colName(Math.max(cols - 1, 0))}${Math.max(rows.length, 1)}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${body}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    `</worksheet>`
  );
}

function buildXlsx(sheets: Sheet[]): Uint8Array {
  const names = sheets.map((s) => s.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31));
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join("") +
        `</Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
        `</sheets><definedNames>` +
        names.map((n, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(n.replace(/'/g, "''"))}'!$A$1:$${colName((sheets[i].rows[0]?.length ?? 1) - 1)}$${sheets[i].rows.length}</definedName>`).join("") +
        `</definedNames></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      "xl/styles.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
        `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
        `</styleSheet>`,
    ],
    ...sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)]),
  ];
  return zip(files);
}

// ---------- A stored (uncompressed) zip ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_DATE = (1 << 5) | 1; // 1980-01-01; zero isn't a valid date

function zip(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of files) {
    const path = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const head = new Uint8Array(30 + path.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // UTF-8 names
    h.setUint16(12, DOS_DATE, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, path.length, true);
    head.set(path, 30);
    const dir = new Uint8Array(46 + path.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint16(14, DOS_DATE, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, data.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, path.length, true);
    d.setUint32(42, offset, true);
    dir.set(path, 46);
    local.push(head, data);
    central.push(dir);
    offset += head.length + data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const part of [...local, ...central, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
