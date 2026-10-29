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

// "2 ¾" for a sheet, "3" otherwise. An amount between the pieces shows in twelfths ("1 5/12").
export function formatStock(n: number, sheet = false): string {
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

// Pieces by size (Harel, 2026-10-29): a fraction item keeps how many pieces of each size are on
// the shelf, keyed by twelfths ("12" a full one, "6" a half), because two halves can't make a
// long cut. in_stock stays their sum.
export type Pieces = Record<string, number>;

export const ALL_PIECES = [
  { twelfths: 12, label: "Full", value: 1 },
  ...SHEET_PIECES.map((p) => ({ twelfths: Math.round(p.value * 12), label: p.label as string, value: p.value as number })),
].sort((a, b) => b.twelfths - a.twelfths);

// Twelfths that aren't a standard piece split into ones that are where they can (7 = ⅓ + ¼).
const SPLIT: Record<number, number[]> = { 7: [4, 3], 10: [6, 4], 11: [8, 3] };

const sumOf = (p: Pieces) => Object.entries(p).reduce((s, [k, n]) => s + Number(k) * n, 0);

function addTwelfths(p: Pieces, twelfths: number) {
  const bump = (k: number) => (p[String(k)] = (p[String(k)] ?? 0) + 1);
  for (let i = 0; i < Math.floor(twelfths / 12); i++) bump(12);
  const rest = twelfths % 12;
  if (rest) (SPLIT[rest] ?? [rest]).forEach(bump);
}

function drop(p: Pieces, k: number) {
  p[String(k)] -= 1;
  if (p[String(k)] <= 0) delete p[String(k)];
}

const sizes = (p: Pieces) => Object.keys(p).map(Number).sort((a, b) => a - b);

// Take `twelfths` of material: an exact piece first, else cut the smallest piece that's big
// enough (the offcut goes back), else use up the biggest pieces.
function takeTwelfths(p: Pieces, twelfths: number) {
  let need = twelfths;
  while (need > 0 && Object.keys(p).length) {
    if (need <= 12 && p[String(need)]) {
      drop(p, need);
      return;
    }
    const cut = sizes(p).find((k) => k > need);
    if (cut !== undefined) {
      drop(p, cut);
      addTwelfths(p, cut - need);
      return;
    }
    const big = sizes(p).at(-1)!;
    drop(p, big);
    need -= big;
  }
}

function clean(pieces?: Pieces | null): Pieces {
  const out: Pieces = {};
  for (const [k, n] of Object.entries(pieces ?? {})) {
    const key = Number(k);
    const count = Math.floor(Number(n));
    if (Number.isInteger(key) && key > 0 && count > 0) out[String(key)] = count;
  }
  return out;
}

// The pieces, made to add up to the stock: items from before pieces (or a typed count) get the
// difference as full pieces plus one piece for the rest.
export function normalizePieces(inStock: number, pieces?: Pieces | null): Pieces {
  const p = clean(pieces);
  const total = Math.round(Math.max(0, inStock) * 12);
  const have = sumOf(p);
  if (have < total) addTwelfths(p, total - have);
  if (have > total) takeTwelfths(p, have - total);
  return p;
}

// One step on the stock. With a piece size, adds or takes one piece of that size per step
// (taking a size there's none of cuts it from a bigger piece). A plain ±1 adds or takes a full
// piece (no full left: the biggest piece). Any other amount adds full pieces or takes material.
export function adjustPieceBucket(inStock: number, pieces: Pieces | null | undefined, delta: number, bucketTwelfths?: number): { inStock: number; pieces: Pieces } {
  const p = normalizePieces(inStock, pieces);
  const bucket = bucketTwelfths ?? (Math.abs(delta) === 1 ? 12 : undefined);
  if (bucket) {
    const count = Math.max(1, Math.round((Math.abs(delta) * 12) / bucket));
    for (let i = 0; i < count; i++) {
      if (delta > 0) addTwelfths(p, bucket);
      else if (p[String(bucket)]) drop(p, bucket);
      else if (bucket === 12) {
        if (Object.keys(p).length) drop(p, sizes(p).at(-1)!);
      } else if (sizes(p).some((k) => k > bucket)) takeTwelfths(p, bucket);
    }
  } else if (delta > 0) addTwelfths(p, Math.round(delta * 12));
  else takeTwelfths(p, Math.round(-delta * 12));
  return { inStock: sumOf(p) / 12, pieces: p };
}

// Can one piece of this size be taken: one on the shelf, or a bigger one to cut it from.
export function canTakePiece(inStock: number, pieces: Pieces | null | undefined, twelfths: number): boolean {
  const p = normalizePieces(inStock, pieces);
  return !!p[String(twelfths)] || sizes(p).some((k) => k > twelfths) || (twelfths === 12 && Object.keys(p).length > 0);
}

const mm = (text: string | undefined) => {
  const m = /(\d+(?:\.\d+)?)/.exec(text ?? "");
  return m ? Number(m[1]) : null;
};

// A piece's real size from the item's length or sheet size: "450mm" for half a 900mm tube,
// "500×450" for half a 500×900 plate (the long side is cut). No size known: the fraction.
export function pieceSizeLabel(piece: { label: string; value: number }, specs: Record<string, string>, name = ""): { primary: string; sub?: string } {
  const sub = piece.value === 1 ? undefined : piece.label;
  const fallback = { primary: piece.label };
  let length = mm(specs.length);
  if (!length) {
    // "… 900mm" in the name, but not a diameter, a wall or a cross-section like "40x20mm".
    const hits = [...name.matchAll(/(?<![Ø\d.x×]\s*)(\d+(?:\.\d+)?)\s*mm(?!\s*wall)/gi)].map((m) => Number(m[1])).filter((n) => n >= 100);
    length = hits.at(-1) ?? null;
  }
  if (!specs.length) {
    // A sheet size: both sides at least 100mm (a tube's "40x20" is its cross-section).
    const s = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/.exec(specs.size ?? "") ?? /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/.exec(name);
    if (s && Number(s[1]) >= 100 && Number(s[2]) >= 100) {
      const [w, l] = [Number(s[1]), Number(s[2])].sort((a, b) => a - b);
      return { primary: `${w}×${Math.round(l * piece.value)}`, sub };
    }
  }
  if (length) return { primary: `${Math.round(length * piece.value)}mm`, sub };
  return piece.value === 1 ? { primary: "Full" } : fallback;
}

// Stock after one step, for the optimistic view and the server alike: fraction items move their
// pieces too.
export function stepStock(item: { inStock: number; sheet: boolean; pieces?: Pieces | null }, delta: number, bucket?: number): { inStock: number; pieces?: Pieces } {
  if (!item.sheet) return { inStock: snapStock(item.inStock + delta, false) };
  return adjustPieceBucket(item.inStock, item.pieces, delta, bucket);
}

// Stock set to a typed count: the pieces follow (extra as full pieces, less taken as material).
export function countPieces(item: { inStock: number; sheet: boolean; pieces?: Pieces | null }, amount: number): { inStock: number; pieces?: Pieces } {
  const inStock = snapStock(amount, item.sheet);
  if (!item.sheet) return { inStock };
  return { inStock, pieces: normalizePieces(inStock, normalizePieces(item.inStock, item.pieces)) };
}

// One size's count set directly (the Spread rows).
export function setPieceCount(item: { inStock: number; pieces?: Pieces | null }, twelfths: number, count: number): { inStock: number; pieces: Pieces } {
  const p = normalizePieces(item.inStock, item.pieces);
  if (count > 0) p[String(twelfths)] = Math.floor(count);
  else delete p[String(twelfths)];
  return { inStock: sumOf(p) / 12, pieces: p };
}
