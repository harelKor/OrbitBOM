// "Export spreadsheet": the whole inventory as an .xlsx built in the browser, with no library.
// Sheet 1 is everything (Group → Category → Name); then one sheet per category group, without
// the Group column. The headers are ones guessColumns (import.ts) recognises, so a file
// exported here imports back.
// Look (Harel, 2026-10-28): each category is a band, white and soft gray in turn, with a darker
// line where a category starts and ends; darker vertical lines split the four column zones
// (identity, stock, shop, purchasing); shortages are red, orders amber, OK quiet green.

import type { Condition, InvCategory, Item, Location } from "@/components/inventory/types";
import { CATEGORY_GROUPS, groupOf } from "@/config/inventory";
import { getCategory, specLine } from "@/lib/inventory/categories";
import { missing, standing, type Standing } from "@/lib/inventory/season";
import { formatStockExact as formatStock } from "@/lib/inventory/stock";
import { zip } from "@/lib/zip";

type Column = {
  header: string;
  width: [number, number]; // min, max characters
  align?: "center" | "right";
  bold?: boolean;
  money?: boolean;
  zoneEnd?: boolean; // a darker line on its right
  standing?: boolean; // coloured by the item's standing
  notes?: boolean; // right-to-left when it's Hebrew
};

const COLUMNS: Column[] = [
  { header: "Group", width: [14, 20] },
  { header: "Category", width: [18, 26] },
  { header: "Item Name", width: [34, 42], bold: true },
  { header: "Specs", width: [22, 28], zoneEnd: true },
  { header: "In Stock", width: [10, 12], align: "center", bold: true },
  { header: "Needed for Season", width: [12, 19], align: "center" },
  { header: "Robots Need", width: [12, 14], align: "center" },
  { header: "Missing / Short", width: [12, 17], align: "center", standing: true },
  { header: "Standing", width: [11, 12], align: "center", standing: true, zoneEnd: true },
  { header: "Condition", width: [16, 22], align: "center" },
  { header: "Location", width: [14, 22], align: "center", zoneEnd: true },
  { header: "Unit Price ($)", width: [14, 16], align: "right", money: true },
  { header: "Vendor", width: [16, 22], align: "center" },
  { header: "Product URL", width: [30, 45] },
  { header: "Notes", width: [30, 40], notes: true },
];

export const EXPORT_HEADERS = COLUMNS.map((c) => c.header);

type Cell = string | number | null;
type Row = { cells: Cell[]; band: string; standing: Standing };
type Sheet = { name: string; columns: Column[]; rows: Row[] };

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
    const cells: Cell[] = [
      groupLabel.get(group) ?? group,
      cat?.label ?? i.category,
      i.name,
      specLine(cat, i.specs) || null,
      amount(i.inStock, i.sheet),
      amount(i.seasonNeed, i.sheet) || null,
      i.usage?.need || null,
      missing(i, "any") || null,
      STANDING[standing(i, "any")],
      // An item with variants: each one's count and condition ("3 New, 2 Worn").
      i.variants?.length ? i.variants.map((v) => `${v.count} ${conditionLabel.get(v.conditionId ?? "") ?? "no condition"}`).join(", ") : (conditionLabel.get(i.conditionId ?? "") ?? null),
      locationName.get(locationOf(i) ?? "") ?? null,
      i.price,
      link ? (link.site ?? null) : null,
      link?.url ?? null,
      i.note,
    ];
    const row: Row = { cells, band: `${group}|${i.category}`, standing: standing(i, "any") };
    return { group, cat: catRank.get(i.category) ?? 1e9, name: i.name, row };
  });
  rows.sort(
    (a, b) =>
      (groupRank.get(a.group) ?? 99) - (groupRank.get(b.group) ?? 99) ||
      a.cat - b.cat ||
      a.name.localeCompare(b.name),
  );

  const sheets: Sheet[] = [{ name: "All Inventory", columns: COLUMNS, rows: rows.map((r) => r.row) }];
  for (const g of CATEGORY_GROUPS) {
    const mine = rows.filter((r) => r.group === g.id);
    // The tab is the group, so its sheet leaves the Group column out.
    if (mine.length) sheets.push({ name: g.label, columns: COLUMNS.slice(1), rows: mine.map((r) => ({ ...r.row, cells: r.row.cells.slice(1) })) });
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

// ---------- Colours and cell styles ----------

const C = {
  white: "FFFFFF",
  band: "F3F4F6",
  innerWhite: "E2E8F0",
  innerGray: "CBD5E1",
  divider: "94A3B8",
  header: "0000CC",
  headerLine: "3B3BE0",
  shortFill: "FEE2E2",
  shortText: "991B1B",
  orderedFill: "FEF3C7",
  orderedText: "92400E",
  okText: "166534",
};

type Line = [style: "thin" | "medium", color: string] | null;
type Style = {
  bold?: boolean;
  color?: string;
  fill?: string;
  align?: "center" | "right";
  rtl?: boolean;
  money?: boolean;
  left?: Line;
  right?: Line;
  top?: Line;
  bottom?: Line;
};

// styles.xml is built from the styles the cells use; each distinct one gets an index.
function styleBook() {
  const fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const seen = new Map<string, number>();
  const indexOf = (list: string[], xml: string) => {
    const i = list.indexOf(xml);
    return i >= 0 ? i : list.push(xml) - 1;
  };
  const line = (side: string, l: Line | undefined) =>
    l ? `<${side} style="${l[0]}"><color rgb="FF${l[1]}"/></${side}>` : `<${side}/>`;
  const id = (s: Style) => {
    const key = JSON.stringify(s);
    const known = seen.get(key);
    if (known !== undefined) return known;
    const font = indexOf(fonts, `<font>${s.bold ? "<b/>" : ""}<sz val="11"/>${s.color ? `<color rgb="FF${s.color}"/>` : ""}<name val="Calibri"/></font>`);
    const fill = s.fill ? indexOf(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${s.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const border = indexOf(borders, `<border>${line("left", s.left)}${line("right", s.right)}${line("top", s.top)}${line("bottom", s.bottom)}<diagonal/></border>`);
    const align = `<alignment${s.align ? ` horizontal="${s.align}"` : ""} vertical="center"${s.rtl ? ' readingOrder="2"' : ""}/>`;
    const i =
      xfs.push(
        `<xf numFmtId="${s.money ? 164 : 0}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`,
      ) - 1;
    seen.set(key, i);
    return i;
  };
  const xml = () =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/></numFmts>` +
    `<fonts count="${fonts.length}">${fonts.join("")}</fonts>` +
    `<fills count="${fills.length}">${fills.join("")}</fills>` +
    `<borders count="${borders.length}">${borders.join("")}</borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;
  return { id, xml };
}

const HEBREW = /[֐-׿]/;

function headerStyle(cols: Column[], x: number): Style {
  const divider: Line = ["medium", C.divider];
  const thin: Line = ["thin", C.headerLine];
  return {
    bold: true,
    color: C.white,
    fill: C.header,
    align: "center",
    left: x > 0 && cols[x - 1].zoneEnd ? divider : thin,
    right: cols[x].zoneEnd ? divider : thin,
    top: thin,
    bottom: divider,
  };
}

function cellStyle(cols: Column[], x: number, row: Row, value: Cell, bandIndex: number, first: boolean, last: boolean): Style {
  const col = cols[x];
  const gray = bandIndex % 2 === 1;
  const inner: Line = ["thin", gray ? C.innerGray : C.innerWhite];
  const divider: Line = ["medium", C.divider];
  const s: Style = {
    fill: gray ? C.band : C.white,
    left: x > 0 && cols[x - 1].zoneEnd ? divider : inner,
    right: col.zoneEnd ? divider : inner,
    top: first ? divider : inner,
    bottom: last ? divider : inner,
  };
  // An empty cell keeps only its band and lines.
  if (value == null || value === "") return s;
  if (col.bold) s.bold = true;
  if (col.align) s.align = col.align;
  if (col.money && typeof value === "number") s.money = true;
  if (col.notes && typeof value === "string" && HEBREW.test(value)) Object.assign(s, { align: "right", rtl: true });
  if (col.standing) {
    if (row.standing === "short") Object.assign(s, { fill: C.shortFill, color: C.shortText, bold: true });
    else if (row.standing === "ordered") Object.assign(s, { fill: C.orderedFill, color: C.orderedText, bold: true });
    else s.color = C.okText;
  }
  return s;
}

// ---------- A minimal .xlsx: inline strings, frozen header, filter, sized columns ----------

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

const cellXml = (ref: string, style: number, v: Cell) =>
  v == null || v === ""
    ? `<c r="${ref}" s="${style}"/>`
    : typeof v === "number"
      ? `<c r="${ref}" s="${style}"><v>${v}</v></c>`
      : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;

function sheetXml({ columns, rows }: Sheet, styles: ReturnType<typeof styleBook>) {
  // Wide enough for the header and the longest value, within the column's range.
  const widths = columns.map((c, x) => {
    const longest = Math.max(0, ...rows.map((r) => String(r.cells[x] ?? "").length));
    return Math.max(c.header.length + 3, Math.min(c.width[1], Math.max(c.width[0], longest + 2)));
  });
  const head = `<row r="1" ht="26" customHeight="1">${columns.map((c, x) => cellXml(`${colName(x)}1`, styles.id(headerStyle(columns, x)), c.header)).join("")}</row>`;
  let bandIndex = -1;
  const body = rows
    .map((r, y) => {
      const first = r.band !== rows[y - 1]?.band;
      const last = r.band !== rows[y + 1]?.band;
      if (first) bandIndex++;
      const cells = r.cells.map((v, x) => cellXml(`${colName(x)}${y + 2}`, styles.id(cellStyle(columns, x, r, v, bandIndex, first, last)), v)).join("");
      return `<row r="${y + 2}" ht="20" customHeight="1">${cells}</row>`;
    })
    .join("");
  const last = `${colName(columns.length - 1)}${rows.length + 1}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    // Printed landscape, one page wide.
    `<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="20" customHeight="1"/>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${head}${body}</sheetData>` +
    `<autoFilter ref="A1:${last}"/>` +
    `<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>` +
    `<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>` +
    `</worksheet>`
  );
}

function buildXlsx(sheets: Sheet[]): Uint8Array {
  const names = sheets.map((s) => s.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 31));
  const styles = styleBook();
  const worksheets = sheets.map((s, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s, styles)]);
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
        names.map((n, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(n.replace(/'/g, "''"))}'!$A$1:$${colName(sheets[i].columns.length - 1)}$${sheets[i].rows.length + 1}</definedName>`).join("") +
        `</definedNames></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ["xl/styles.xml", styles.xml()],
    ...worksheets,
  ];
  return zip(files);
}
