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
