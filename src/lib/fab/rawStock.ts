// The robot's Raw stock planner (Harel, 2026-11-07): the robot's plate, tube, box tube and shaft
// parts grouped by stock (material and size), every copy laid out on stock pieces of one chosen
// size, to decide how much raw stock to prepare. Pure: the server groups the parts
// (src/lib/data/rawStock.ts) and the browser lays them out, so the small server never nests.
//
// A group is the Raw Stock inventory item the parts are linked to (the item already is "material
// + thickness" or "material + profile + wall"). Parts with a material but no item are grouped by
// their material and measured stock shape (Harel, 2026-11-07). Sizes come from the shape the
// review measured from the robot's 3D model (`geometry.shape`), else its bounding box.

import { MADE_FROM, NOT_LAID_OUT, NOT_MADE, PLATE_GAP, PLATE_MARGIN, PLATE_PRESETS, LENGTH_PRESETS, SAW_KERF } from "@/config/rawStock";
import { STATUSES, getStatus } from "@/config/statuses";
import { printerOf } from "@/config/machines";
import type { PartGeometry } from "@/db/schema";
import { categoryOf, getCategory, type InvCategory } from "@/lib/inventory/categories";
import { isSheetGoods, pieceBase, pieceRows, sortedRows, SIZE_KEY, type StoredPieces } from "@/lib/inventory/stock";
import { computeStatus, type StatusInput } from "@/lib/status";
import { cornerOf, cutLengths, footprint, nestOnSheets } from "./layout";

export type StockKind = "plate" | "length";

export type RawPartRow = StatusInput & {
  id: string;
  name: string;
  systemName: string;
  material: string | null;
  inventoryItemId: string | null;
  geometry: PartGeometry | null;
};
export type RawItemRow = { id: string; name: string; category: string | null; specs: Record<string, string>; inStock: number; pieces: StoredPieces };

export type RawPart = {
  partId: string;
  name: string;
  systemName: string;
  quantity: number;
  status: string;
  color: string;
  made: boolean;
  w: number; // plate: the longer side; length: the part's length (mm)
  h: number; // plate: the shorter side; length: 0
  approx: boolean; // from the bounding box, not a measured stock shape
};
export type RawSize = { size: string; label: string; onShelf: number };
export type RawGroup = {
  key: string; // the item's id, or "auto:…" for parts with no item
  itemId: string | null;
  title: string;
  subtitle: string; // the category, or "Not linked to an item"
  kind: StockKind;
  parts: RawPart[];
  missing: { partId: string; name: string; reason: string }[];
  sizes: RawSize[]; // the item's shelf pieces first, then the presets
  size: string; // the chosen piece size
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const MADE_AT = STATUSES.findIndex((s) => s.name === MADE_FROM);
export const isMade = (status: string) => !NOT_MADE.includes(status) && STATUSES.findIndex((s) => s.name === status) >= MADE_AT;

export function sizeLabel(size: string): string {
  if (size[0] === "m") return `${size.slice(1)} mm`;
  if (size[0] === "p") return size.slice(1).replace("x", "×");
  return size;
}

// "500x900" or "500×900" for a plate, "1000" for a length; null when it isn't one.
export function parseCustomSize(text: string, kind: StockKind): string | null {
  if (kind === "plate") {
    const m = /^\s*(\d{2,5})\s*[x×*]\s*(\d{2,5})\s*$/.exec(text);
    return m ? `p${Number(m[1])}x${Number(m[2])}` : null;
  }
  const m = /^\s*(\d{2,5})\s*(mm)?\s*$/.exec(text);
  return m ? `m${Number(m[1])}` : null;
}

// A size key's piece, mm: plates long side first.
export function pieceOf(size: string): { w: number; h: number } | null {
  if (!SIZE_KEY.test(size)) return null;
  if (size[0] === "m") return { w: Number(size.slice(1)), h: 0 };
  if (size[0] === "p") {
    const [a, b] = size.slice(1).split("x").map(Number);
    return { w: Math.max(a, b), h: Math.min(a, b) };
  }
  return null;
}

function partSize(row: RawPartRow, kind: StockKind): { w: number; h: number; approx: boolean } | { reason: string } {
  const g = row.geometry;
  const shape = g?.shape;
  if (kind === "plate") {
    if (shape?.kind === "plate" && shape.d1 && shape.d2) return { w: Math.max(shape.d1, shape.d2), h: Math.min(shape.d1, shape.d2), approx: false };
    if (g?.sheetMetal) return { reason: "Sheet metal: its flat size isn't measured here. Lay it out in To Fab." };
    if (g?.bbox) return { w: g.bbox[2], h: g.bbox[1], approx: true };
  } else {
    if (shape?.length && shape.kind !== "plate" && shape.kind !== "block") return { w: shape.length, h: 0, approx: false };
    if (g?.bbox) return { w: g.bbox[2], h: 0, approx: true };
  }
  return { reason: "No size measured yet: update the robot's 3D model." };
}

// The stock a part with no item is cut from, by its material and measured shape.
function autoStock(row: RawPartRow): { key: string; title: string; kind: StockKind } | null {
  const s = row.geometry?.shape;
  const mat = row.material?.trim();
  if (!s || !mat) return null;
  if (s.kind === "plate" && s.t) return { key: `plate|${mat}|${r1(s.t)}`, title: `${mat} ${r1(s.t)}mm plate`, kind: "plate" };
  if (s.kind === "box-tube" && s.d1 && s.d2) {
    const wall = s.wall ? `x${r1(s.wall)}` : "";
    return { key: `box|${mat}|${r1(s.d1)}x${r1(s.d2)}${wall}`, title: `${mat} ${r1(s.d1)}x${r1(s.d2)}${wall} box tube`, kind: "length" };
  }
  if (s.kind === "round-tube" && s.d2) {
    const wall = s.wall ? `x${r1(s.wall)}` : "";
    return { key: `tube|${mat}|${r1(s.d2)}${wall}`, title: `${mat} ${r1(s.d2)}${wall} tube`, kind: "length" };
  }
  if (s.kind === "hex" && s.d1) return { key: `hex|${mat}|${r1(s.d1)}`, title: `${mat} ${r1(s.d1)}mm hex${s.thunder ? " (ThunderHex)" : ""}`, kind: "length" };
  if (s.kind === "rod" && s.d1) return { key: `rod|${mat}|${r1(s.d1)}`, title: `${mat} Ø${r1(s.d1)}mm rod`, kind: "length" };
  return null;
}

// The item's kind: a sheet size or a length on it, else what its category's name says.
function itemKind(item: RawItemRow, cat: InvCategory | undefined): StockKind {
  const base = pieceBase(item.specs, item.name);
  if (base.kind === "xy") return "plate";
  if (base.kind === "mm") return "length";
  return isSheetGoods(cat?.label ?? item.name) ? "plate" : "length";
}

function shelfSizes(item: RawItemRow | null, kind: StockKind): RawSize[] {
  const presets = kind === "plate" ? PLATE_PRESETS : LENGTH_PRESETS;
  const out: RawSize[] = [];
  if (item) {
    const base = pieceBase(item.specs, item.name);
    // The full piece first (its sheet size or length), then the pieces on the shelf.
    const full = base.kind === "xy" && kind === "plate" ? `p${base.x}x${base.y}` : base.kind === "mm" && kind === "length" ? `m${base.length}` : null;
    if (full) out.push({ size: full, label: sizeLabel(full), onShelf: 0 });
    if (base.kind !== "none") {
      for (const r of sortedRows(pieceRows(item.inStock, item.pieces, base), base)) {
        if (r.count <= 0) continue; // a size the shelf has none of
        let size = r.size;
        // A fraction ("½") as the real piece off the full one.
        if (size[0] === "f" && full) {
          const share = Number(size.slice(1)) / 12;
          size = base.kind === "mm" ? `m${Math.round(base.length * share)}` : base.kind === "xy" ? `p${base.x}x${Math.round(base.y * share)}` : size;
        }
        if (!pieceOf(size) || (kind === "plate") !== (size[0] === "p")) continue;
        const have = out.find((s) => s.size === size);
        if (have) have.onShelf += r.count;
        else out.push({ size, label: sizeLabel(size), onShelf: r.count });
      }
    }
  }
  for (const p of presets) if (!out.some((s) => s.size === p)) out.push({ size: p, label: sizeLabel(p), onShelf: 0 });
  return out;
}

// The robot's parts as stock groups. `saved`: the piece size the team chose per group.
export function groupRawStock(rows: RawPartRow[], items: RawItemRow[], cats: InvCategory[], saved: Record<string, string> = {}): RawGroup[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const groups = new Map<string, RawGroup & { item: RawItemRow | null }>();
  const add = (key: string, make: () => RawGroup & { item: RawItemRow | null }, row: RawPartRow) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = make()));
    const status = computeStatus(row);
    const size = partSize(row, g.kind);
    if ("reason" in size) g.missing.push({ partId: row.id, name: row.name, reason: size.reason });
    else
      g.parts.push({
        partId: row.id,
        name: row.name,
        systemName: row.systemName,
        quantity: Math.max(1, row.quantity),
        status,
        color: getStatus(status)?.color ?? "#94a3b8",
        made: isMade(status),
        ...size,
      });
  };
  for (const row of rows) {
    if (row.classification === "cots") continue;
    const item = row.inventoryItemId ? itemById.get(row.inventoryItemId) : undefined;
    if (item) {
      const cat = getCategory(cats, categoryOf(item, cats));
      if (cat?.group !== "consumables" || NOT_LAID_OUT.includes(cat.id)) continue;
      add(item.id, () => ({ key: item.id, itemId: item.id, item, title: item.name, subtitle: cat.label, kind: itemKind(item, cat), parts: [], missing: [], sizes: [], size: "" }), row);
      continue;
    }
    if (row.inventoryItemId || printerOf(row)) continue;
    const auto = autoStock(row);
    if (!auto) continue;
    // A material named like filament or billet stock isn't laid out either.
    const guess = categoryOf({ name: row.material ?? "", category: null }, cats);
    if (NOT_LAID_OUT.includes(guess)) continue;
    const key = `auto:${auto.key}`;
    add(key, () => ({ key, itemId: null, item: null, title: auto.title, subtitle: "Not linked to an inventory item", kind: auto.kind, parts: [], missing: [], sizes: [], size: "" }), row);
  }
  return [...groups.values()]
    .filter((g) => g.parts.length || g.missing.length)
    .map(({ item, ...g }) => {
      const sizes = shelfSizes(item, g.kind);
      const want = saved[g.key];
      const ok = want && pieceOf(want) && (g.kind === "plate") === (want[0] === "p");
      if (ok && !sizes.some((s) => s.size === want)) sizes.push({ size: want, label: sizeLabel(want), onShelf: 0 });
      return { ...g, sizes, size: ok ? want : sizes[0].size };
    })
    .sort((a, b) => Number(!!b.itemId) - Number(!!a.itemId) || (a.kind === b.kind ? 0 : a.kind === "plate" ? -1 : 1) || a.title.localeCompare(b.title));
}

// ---------- the layout of one group on one piece size ----------

export type PlanItem = { partId: string; copy: number; x: number; y: number; w: number; h: number };
export type PlanPiece = { items: PlanItem[]; used: number }; // `used`: share of the piece's area or length the parts take
export type RawPlan = {
  pieceW: number;
  pieceH: number; // 0 for a length
  pieces: PlanPiece[];
  tooBig: string[]; // part ids that don't fit on one piece
  usage: number; // the parts' share of all the pieces (0-1)
  copies: number;
  madeCopies: number;
};

export function planGroup(group: Pick<RawGroup, "kind" | "parts">, size: string): RawPlan {
  const piece = pieceOf(size) ?? { w: 0, h: 0 };
  const copies = group.parts.reduce((t, p) => t + p.quantity, 0);
  const madeCopies = group.parts.reduce((t, p) => t + (p.made ? p.quantity : 0), 0);
  const byId = new Map(group.parts.map((p) => [p.partId, p]));
  if (group.kind === "plate") {
    const { sheets, tooBig } = nestOnSheets(group.parts, piece.w, piece.h, PLATE_GAP, PLATE_MARGIN);
    const area = piece.w * piece.h || 1;
    const pieces = sheets.map((s) => {
      const items = s.placements.map((pl) => {
        const part = byId.get(pl.partId)!;
        const [x, y] = cornerOf(part, pl);
        const [w, h] = footprint(part, pl.rotation);
        return { partId: pl.partId, copy: pl.copy, x, y, w, h };
      });
      return { items, used: items.reduce((t, i) => t + i.w * i.h, 0) / area };
    });
    const total = pieces.reduce((t, p) => t + p.used, 0);
    return { pieceW: piece.w, pieceH: piece.h, pieces, tooBig, usage: pieces.length ? total / pieces.length : 0, copies, madeCopies };
  }
  const { bars, tooLong } = cutLengths(
    group.parts.map((p) => ({ partId: p.partId, length: p.w, quantity: p.quantity })),
    piece.w,
    SAW_KERF,
  );
  const length = piece.w || 1;
  const pieces = bars.map((b) => {
    const items = b.cuts.map((c) => ({ partId: c.partId, copy: c.copy, x: c.start, y: 0, w: c.length, h: 0 }));
    return { items, used: items.reduce((t, i) => t + i.w, 0) / length };
  });
  const total = pieces.reduce((t, p) => t + p.used, 0);
  return { pieceW: piece.w, pieceH: 0, pieces, tooBig: tooLong, usage: pieces.length ? total / pieces.length : 0, copies, madeCopies };
}
