// Stock amounts. Most items count whole units; sheet items (plates) also hold pieces of a sheet,
// kept in twelfths so ¼ ⅓ ½ ⅔ ¾ add up exactly.

export const SHEET_PIECES = [
  { label: "¼", value: 1 / 4 },
  { label: "⅓", value: 1 / 3 },
  { label: "½", value: 1 / 2 },
  { label: "⅔", value: 2 / 3 },
  { label: "¾", value: 3 / 4 },
] as const;

const TWELFTHS: Record<number, string> = { 3: "¼", 4: "⅓", 6: "½", 8: "⅔", 9: "¾" };

// A stored amount: whole units, or twelfths of a sheet. Never negative.
export function snapStock(n: number, sheet: boolean): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return sheet ? Math.round(n * 12) / 12 : Math.round(n);
}

// A count to read at a glance: whole units. A sheet item holding part of a sheet shows the
// nearest whole number with a "~" ("~3"); the exact pieces live in the pieces menu and Spread.
export function formatStock(n: number, sheet = false): string {
  const whole = Math.round(n);
  if (!sheet || Math.abs(n - whole) <= 1e-6) return String(whole);
  return `~${whole}`;
}

// The exact amount, for typing boxes, history and exports: "2 ¾" for a sheet, "3" otherwise.
// An amount between the pieces shows in twelfths ("1 5/12").
export function formatStockExact(n: number, sheet = false): string {
  if (!sheet) return String(Math.round(n));
  const twelfths = Math.round(n * 12);
  const whole = Math.floor(twelfths / 12);
  const rest = twelfths % 12;
  if (!rest) return String(whole);
  const piece = TWELFTHS[rest] ?? `${rest}/12`;
  return whole ? `${whole} ${piece}` : piece;
}

// What someone typed in a stock box: "3", "2.5", "2 3/4", "¾", "1 ⅓".
export function parseStock(text: string, sheet: boolean): number | null {
  const t = text.trim();
  if (!t) return 0;
  let total = 0;
  for (const token of t.split(/\s+/)) {
    const glyph = SHEET_PIECES.find((p) => p.label === token);
    const frac = /^(\d+)\/(\d+)$/.exec(token);
    let v: number;
    if (glyph) v = glyph.value;
    else if (frac && Number(frac[2]) > 0) v = Number(frac[1]) / Number(frac[2]);
    else if (/^\d+(\.\d+)?$/.test(token)) v = Number(token);
    else return null;
    total += v;
  }
  if (!sheet && !Number.isInteger(total)) return null;
  return snapStock(total, sheet);
}

// Plates and sheets say "sheets"; other fraction items (tubes, shafts, filament) say plain quantities.
export function isSheetGoods(label: string): boolean {
  return /plate|sheet|polycarb|wood/i.test(label);
}

// Pieces by size (Harel, 2026-10-29/30): a fraction item keeps a list of piece sizes and how many
// of each are on the shelf; in_stock is their sum, each piece counting as its share of a full one.
// A size is "f6" (a preset fraction in twelfths: half the full length or sheet), "m450" (450mm of
// a tube or shaft) or "p500x450" (a 500×450 plate). Older rows hold a { twelfths: count } map or
// nothing; they read as the presets, with the stock as full pieces plus one for the rest.
export type PieceRow = { size: string; count: number };
export type StoredPieces = PieceRow[] | Record<string, number> | null | undefined;
// What a full piece is: a length, a sheet size, or unknown (filament: fractions only).
export type PieceBase = { kind: "mm"; length: number } | { kind: "xy"; x: number; y: number } | { kind: "none" };

export const PRESET_TWELFTHS = [12, 9, 8, 6, 4, 3];
// Length stock's quick lengths (Harel, 2026-11-24): ¼, ½, ¾ and all of the full piece.
const LENGTH_TWELFTHS = [12, 9, 6, 3];
// Tubes, box tubes and shafts: stock bought by length. With no Length typed (nor one in the name)
// their full piece counts as 2000 mm, so the quick lengths are 500 / 1000 / 1500 / 2000; the
// spec itself stays empty (nothing fills the length in).
export const LENGTH_STOCK = new Set(["square-tubes", "round-tubes", "shafts"]);
const DEFAULT_LENGTH = 2000;
export const SIZE_KEY = /^(f\d{1,3}|m\d{1,5}|p\d{1,5}x\d{1,5})$/;
const EPS = 1e-3;

// Twelfths that aren't a preset split into ones that are where they can (7 = ⅓ + ¼).
const SPLIT: Record<number, number[]> = { 7: [4, 3], 10: [6, 4], 11: [8, 3] };

const num = (text: string | undefined) => {
  const m = /(\d+(?:\.\d+)?)/.exec(text ?? "");
  return m ? Number(m[1]) : null;
};
const SIZE_RE = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i;

// The full piece from the item's specs or name: its Length spec, else a sheet size (both sides at
// least 100mm, so a tube's "40x20" cross-section doesn't count), else a length in the name, else
// for length stock (`category`) 2000 mm.
export function pieceBase(specs: Record<string, string>, name = "", category?: string | null): PieceBase {
  const length = num(specs.length);
  if (length) return { kind: "mm", length };
  const s = SIZE_RE.exec(specs.size ?? "") ?? SIZE_RE.exec(name);
  if (s && Number(s[1]) >= 100 && Number(s[2]) >= 100) {
    const [x, y] = [Number(s[1]), Number(s[2])].sort((a, b) => a - b);
    return { kind: "xy", x, y };
  }
  // "… 900mm" in the name, but not a diameter, a wall or a cross-section like "40x20mm".
  const hits = [...name.matchAll(/(?<![Ø\d.x×]\s*)(\d+(?:\.\d+)?)\s*mm(?!\s*wall)/gi)].map((m) => Number(m[1])).filter((n) => n >= 100);
  if (hits.length) return { kind: "mm", length: hits.at(-1)! };
  return category && LENGTH_STOCK.has(category) ? { kind: "mm", length: DEFAULT_LENGTH } : { kind: "none" };
}

// A size's share of a full piece. A length or plate the base can't measure counts as one.
export function pieceRatio(size: string, base: PieceBase): number {
  if (size[0] === "f") return Number(size.slice(1)) / 12;
  if (size[0] === "m") return base.kind === "mm" ? Number(size.slice(1)) / base.length : 1;
  const [x, y] = size.slice(1).split("x").map(Number);
  return base.kind === "xy" ? (x * y) / (base.x * base.y) : 1;
}

const GLYPH: Record<string, string> = { "1/4": "¼", "1/3": "⅓", "1/2": "½", "2/3": "⅔", "3/4": "¾" };
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

// A share as a short fraction: "½", "5/4", "3/1"; "Full" for one; "≈0.27" when nothing near fits.
export function fractionText(r: number): string {
  if (Math.abs(r - 1) < EPS) return "Full";
  for (const d of [1, 2, 3, 4, 6, 8, 12]) {
    const n = Math.round(r * d);
    if (n > 0 && Math.abs(r - n / d) < 0.005) {
      const g = gcd(n, d);
      const text = `${n / g}/${d / g}`;
      return GLYPH[text] ?? text;
    }
  }
  return `≈${r.toFixed(2)}`;
}

// A size as it shows: the real length or plate ("450mm", "500×450") and its share ("½", "5/4").
export function pieceLabel(size: string, base: PieceBase): { primary: string; sub: string } {
  const r = pieceRatio(size, base);
  const sub = fractionText(r);
  if (size[0] === "m") return { primary: `${size.slice(1)}mm`, sub };
  if (size[0] === "p") return { primary: size.slice(1).replace("x", "×"), sub };
  if (base.kind === "mm") return { primary: `${Math.round(base.length * r)}mm`, sub };
  if (base.kind === "xy") return { primary: `${base.x}×${Math.round(base.y * r)}`, sub };
  return { primary: sub, sub: "" };
}

const sumRows = (rows: PieceRow[], base: PieceBase) => Math.round(rows.reduce((t, r) => t + r.count * pieceRatio(r.size, base), 0) * 1e4) / 1e4;

function readRows(stored: StoredPieces, base?: PieceBase): PieceRow[] {
  const rows: PieceRow[] = [];
  const put = (size: string, count: number) => {
    if (!SIZE_KEY.test(size) || !(Number(size.slice(1).split("x")[0]) > 0)) return;
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const row = rows.find((r) => r.size === size);
    if (row) row.count += n;
    else rows.push({ size, count: n });
  };
  if (Array.isArray(stored)) stored.forEach((r) => r && typeof r.size === "string" && put(r.size, r.count));
  else {
    // Nothing yet, or the first { twelfths: count } map: the presets, with what was counted.
    (base?.kind === "mm" ? LENGTH_TWELFTHS : PRESET_TWELFTHS).forEach((t) => put(`f${t}`, 0));
    for (const [k, n] of Object.entries(stored ?? {})) if (/^\d+$/.test(k)) put(`f${k}`, n);
  }
  return rows;
}

// The row of this share, made if there's none: a preset fraction when it is one, else a length
// or plate size off the base (a plate keeps `keepX` across and shortens the other side).
function rowFor(rows: PieceRow[], ratio: number, base: PieceBase, keepX?: number): PieceRow {
  const same = rows.find((r) => Math.abs(pieceRatio(r.size, base) - ratio) < EPS);
  if (same) return same;
  const t = Math.round(ratio * 12);
  let size: string;
  if (Math.abs(ratio - t / 12) < EPS && t > 0) size = `f${t}`;
  else if (base.kind === "mm") size = `m${Math.max(1, Math.round(ratio * base.length))}`;
  else if (base.kind === "xy") {
    const x = keepX ?? base.x;
    size = `p${x}x${Math.max(1, Math.round((ratio * base.x * base.y) / x))}`;
  } else size = `f${Math.max(1, t)}`;
  const row = rows.find((r) => r.size === size) ?? { size, count: 0 };
  if (!rows.includes(row)) rows.push(row);
  return row;
}

function addAmount(rows: PieceRow[], amount: number, base: PieceBase) {
  const whole = Math.floor(amount + EPS);
  if (whole > 0) rowFor(rows, 1, base).count += whole;
  const rest = Math.round((amount - whole) * 12);
  if (rest > 0) (SPLIT[rest] ?? [rest]).forEach((t) => rowFor(rows, t / 12, base).count++);
}

const xOf = (size: string) => (size[0] === "p" ? Number(size.slice(1).split("x")[0]) : undefined);

// Take an amount of material: a piece that size first, else cut the smallest piece that's big
// enough (the offcut goes back as its own size), else use up the biggest pieces.
function takeAmount(rows: PieceRow[], amount: number, base: PieceBase) {
  let need = amount;
  while (need > EPS) {
    const have = rows.filter((r) => r.count > 0).map((r) => ({ r, v: pieceRatio(r.size, base) }));
    if (!have.length) return;
    const exact = have.find((h) => Math.abs(h.v - need) < EPS);
    if (exact) {
      exact.r.count--;
      return;
    }
    const bigger = have.filter((h) => h.v > need).sort((a, b) => a.v - b.v)[0];
    if (bigger) {
      bigger.r.count--;
      rowFor(rows, bigger.v - need, base, xOf(bigger.r.size)).count++;
      return;
    }
    const biggest = have.sort((a, b) => b.v - a.v)[0];
    biggest.r.count--;
    need -= biggest.v;
  }
}

// The rows, made to add up to the stock (older items, a typed count, a move from elsewhere).
export function pieceRows(inStock: number, stored: StoredPieces, base: PieceBase): PieceRow[] {
  const rows = readRows(stored, base);
  const diff = Math.max(0, inStock) - sumRows(rows, base);
  if (diff > EPS) addAmount(rows, diff, base);
  if (diff < -EPS) takeAmount(rows, -diff, base);
  return rows;
}

// Biggest first, the way the Spread and the pieces menu list them.
export function sortedRows(rows: PieceRow[], base: PieceBase): PieceRow[] {
  return [...rows].sort((a, b) => pieceRatio(b.size, base) - pieceRatio(a.size, base));
}

type Stocked = { inStock: number; sheet: boolean; pieces?: StoredPieces; specs: Record<string, string>; name: string; category?: string | null };
type Result = { inStock: number; pieces?: PieceRow[] };
const done = (rows: PieceRow[], base: PieceBase): { inStock: number; pieces: PieceRow[] } => ({ inStock: sumRows(rows, base), pieces: rows });

// One step on the stock, for the optimistic view and the server alike. With a size, adds or takes
// one piece of it (taking a size there's none of cuts it from a bigger piece). A plain ±1 adds or
// takes a full piece (no full left: the biggest). Any other amount adds full pieces or takes material.
export function stepStock(item: Stocked, delta: number, size?: string): Result {
  if (!item.sheet) return { inStock: snapStock(item.inStock + delta, false) };
  const base = pieceBase(item.specs, item.name, item.category);
  const rows = pieceRows(item.inStock, item.pieces, base);
  if (size || Math.abs(delta) === 1) {
    const row = size ? (rows.find((r) => r.size === size) ?? rowFor(rows, pieceRatio(size, base), base)) : rowFor(rows, 1, base);
    if (delta > 0) row.count++;
    else if (row.count > 0) row.count--;
    else if (!size) {
      const biggest = sortedRows(rows, base).find((r) => r.count > 0);
      if (biggest) biggest.count--;
    } else if (canTake(rows, row.size, base)) takeAmount(rows, pieceRatio(row.size, base), base);
  } else if (delta > 0) addAmount(rows, delta, base);
  else takeAmount(rows, -delta, base);
  return done(rows, base);
}

function canTake(rows: PieceRow[], size: string, base: PieceBase) {
  const v = pieceRatio(size, base);
  return rows.some((r) => r.count > 0 && (r.size === size || pieceRatio(r.size, base) > v + EPS));
}

// Can one piece of this size come off the shelf: one there, or a bigger one to cut it from.
export function canTakePiece(item: Stocked, size: string): boolean {
  const base = pieceBase(item.specs, item.name, item.category);
  return canTake(pieceRows(item.inStock, item.pieces, base), size, base);
}

// Stock set to a typed count: the pieces follow (extra as full pieces, less taken as material).
export function countPieces(item: Stocked, amount: number): Result {
  const inStock = snapStock(amount, item.sheet);
  if (!item.sheet) return { inStock };
  const base = pieceBase(item.specs, item.name, item.category);
  return done(pieceRows(inStock, pieceRows(item.inStock, item.pieces, base), base), base);
}

// The Spread's edits: a size's count, a size changed (✏, counts merge into an existing one), a
// size removed (✕, its pieces leave the shelf), a new size (no pieces yet).
export type PieceOp =
  | { kind: "count"; size: string; count: number }
  | { kind: "rename"; size: string; to: string }
  | { kind: "remove"; size: string }
  | { kind: "add"; size: string };

export function applyPieceOp(item: Stocked, op: PieceOp): Result {
  const base = pieceBase(item.specs, item.name, item.category);
  let rows = pieceRows(item.inStock, item.pieces, base);
  const row = rows.find((r) => r.size === op.size);
  if (op.kind === "count") {
    if (row) row.count = Math.max(0, Math.floor(op.count));
    else rows.push({ size: op.size, count: Math.max(0, Math.floor(op.count)) });
  } else if (op.kind === "add") {
    if (!row) rows.push({ size: op.size, count: 0 });
  } else if (op.kind === "remove") rows = rows.filter((r) => r !== row);
  else if (row && op.to !== op.size) {
    const into = rows.find((r) => r.size === op.to);
    if (into) {
      into.count += row.count;
      rows = rows.filter((r) => r !== row);
    } else row.size = op.to;
  }
  return done(rows, base);
}

// What someone typed for a new or changed size: "450" (mm) for a tube, "500x450" for a plate.
export function parseSize(text: string, base: PieceBase): string | null {
  if (base.kind === "xy") {
    const s = SIZE_RE.exec(text);
    if (!s) return null;
    const [x, y] = [Math.round(Number(s[1])), Math.round(Number(s[2]))];
    return x > 0 && y > 0 ? `p${x}x${y}` : null;
  }
  if (base.kind === "mm") {
    const n = Math.round(num(text) ?? 0);
    return n > 0 ? `m${n}` : null;
  }
  return null;
}
