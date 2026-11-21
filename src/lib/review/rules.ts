// Suggest setup's rules (plan §6, "Recognising part types"): the Raw Stock inventory item a part
// is cut from and its processes, from Onshape's own material and the part's shape measured from
// its 3D model (shape.ts). No AI runs on the server; parts these rules can't place are left for
// the member's Claude, through the MCP server, or the designer.
//
// Order: 3D printing materials first (printed, nothing else), then the shape: hex shaft, box
// tube, round tube, round rod, turned spacer, plate (pocketed → CNC), bent sheet, other metal
// parts (LATHE when round, else CNC). Whatever stock the shape names is linked as the exact
// inventory item: material = the item's name and inventoryItemId = its id.

import {
  BENDING_MACHINE,
  DEFAULT_PROCESSES,
  PLATE_TOLERANCE_MM,
  PRINT_MATERIALS,
  PRINTED_SPACER,
  SHAPE_MACHINES,
  TUBE_TOLERANCE_MM,
  WALL_TOLERANCE_MM,
  type ProcessSet,
} from "@/config/autoSetup";
import { getMachine } from "@/config/machines";
import { plateThicknessMm } from "@/config/materials";
import type { PartGeometry } from "@/db/schema";
import type { Shape } from "./shape";

export type SetupInput = {
  classification: "inhouse" | "cots" | "external" | "undefined";
  material: string | null;
  inventoryItemId?: string | null;
  process1: string | null;
  addedProcesses: { machine: string }[];
  geometry: PartGeometry | null;
  onshapeName?: string | null;
  displayName?: string | null;
};

// A Raw Stock inventory item (lib/data/materials.ts listRawStock): `category` is its inventory
// category id.
export type StockItem = { id: string; name: string; category: string; specs: Record<string, string>; rounded?: string };

// Nothing in inventory fits exactly: the nearest item within 20% of the part's size, with a note
// ("40 mm tube (part is 41.59 mm)") that the part window shows in amber until it's approved
// (Harel, 2026-11-21). Beyond 20%, nothing.
export const ROUND_TO_NEAREST = 0.2;
export const ROUNDED_PREFIX = "Rounded to nearest: ";
const r2 = (n: number) => (Math.round(n * 100) / 100).toString();
const rounded = (i: StockItem, note: string): StockItem => ({ ...i, rounded: note });

export type SetupChanges = {
  classification?: "inhouse";
  material?: string;
  inventoryItemId?: string | null; // null: a print leaves its filament item for the plain material
  process1?: string | null;
  process2?: string | null; // the first added process (PartChanges.process2)
};

// No learned habits (Harel, 2026-11-06): processes come from the shape and the team defaults in
// config/autoSetup.ts only. Copying what was set on other parts of the same material also copied
// their mistakes (bending on prints) and one robot's choices onto another.

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
const num = (s: string | undefined) => (s !== undefined && s !== "" && Number.isFinite(Number(s)) ? Number(s) : undefined);

// ---------- materials ----------

const METAL = /alumin|\b(6061|7075|5052|6082)\b|brass|steel|stainless|copper|bronze|titanium/i;
const ALLOY = /\b(6061|7075|5052|6082)\b/;

// A material's family, for matching a part's Onshape material to an item's.
function family(text: string): string | undefined {
  // "Carbon Steel" is steel, not carbon fibre.
  if (/carbon(?!ate|\s*steel)/i.test(text)) return "carbon";
  if (/polycarb|lexan|\bpc\b/i.test(text)) return "poly";
  if (/wood|birch|plywood|\bmdf\b|srpp|sandwich/i.test(text)) return "wood";
  if (/delrin|acetal|\bpom\b/i.test(text)) return "delrin";
  if (/stainless/i.test(text)) return "stainless";
  if (/brass/i.test(text)) return "brass";
  if (/bronze/i.test(text)) return "bronze";
  if (/copper/i.test(text)) return "copper";
  if (/titanium/i.test(text)) return "titanium";
  if (/steel/i.test(text)) return "steel";
  if (/alumin|\b(6061|7075|5052|6082)\b/i.test(text)) return "aluminum";
  return undefined;
}
const itemText = (i: StockItem) => `${i.specs.material ?? ""} ${i.name}`;
// An item with no material named is aluminium (the shop's tube and bar stock).
const itemFamily = (i: StockItem) => family(itemText(i)) ?? "aluminum";

const PLATE_CATEGORY: Record<string, string> = { aluminum: "aluminum-plates", poly: "polycarbonate", wood: "wood-composites" };

// ---------- matching inventory items ----------

// Bent sheet: Onshape sheet metal, or a thin wall that isn't flat (an angle, a U channel). Bent
// plates use the same plate materials as flat ones. A measured wall alone also fits bushings,
// gears and tubes, so the wall must be sheet-thin and much thinner than the part (Harel,
// 2026-11-06: Suggest was bending brass bushings and box tubes).
const isFlat = (bbox: [number, number, number] | undefined) => !!bbox && bbox[0] > 0 && bbox[0] <= bbox[1] * 0.25;
const MAX_SHEET_MM = 6.5;
export const isBent = (g: PartGeometry | null | undefined) => {
  if (!g) return false;
  if (g.sheetMetal) return true;
  const s = g.shape;
  if (s && (s.axisymmetric || ["hex", "rod", "spacer", "round-tube", "box-tube"].includes(s.kind))) return false;
  return !isFlat(g.bbox) && g.wallMm !== undefined && g.wallMm <= MAX_SHEET_MM && !!g.bbox && g.bbox[0] >= 3 * g.wallMm;
};

// An item's plate thicknesses in mm: its thickness spec, its material spec ("3mm 6061-T6") and a
// "3mm" in its name. All of them count: the "12.7mm Aluminum plate" item says 12 in its spec.
function itemThicknesses(i: StockItem): number[] {
  const m = /(\d+(?:\.\d+)?)\s*mm\b/i.exec(i.name);
  const all = [num(i.specs.thickness), i.specs.material ? plateThicknessMm(i.specs.material) : undefined, m ? Number(m[1]) : undefined];
  return [...new Set(all.filter((t): t is number => t !== undefined))];
}

// How much thicker than the part a plate may be. Aluminium is faced down on the CNC: 3/8" (9.53)
// parts come from the 10 mm plate and 11 mm gear hubs from the 12.7 mm one. Polycarbonate and
// wood are cut as they come, so only a sheet's usual undersize (7.7 mm "8 mm" poly).
const THICKER_MM: Record<string, number> = { "aluminum-plates": 2 };
const THICKER_SHEET_MM = 0.5;

// The plate in inventory category `category` for a part `t` thick: the closest within tolerance,
// else the thinnest a little thicker. An alloy the part names (7075) wins; otherwise 6061 first
// for aluminium.
export function plateFor(category: string, t: number | undefined, stock: StockItem[], alloy?: string, round = false) {
  if (t === undefined) return undefined;
  const plates = stock.filter((i) => i.category === category).map((i) => ({ i, ts: itemThicknesses(i) }));
  const rank = (i: StockItem) => (alloy ? (itemText(i).includes(alloy) ? 0 : 1) : /6061/.test(itemText(i)) ? 0 : 1);
  const close = plates
    .map((p) => ({ i: p.i, d: Math.min(...p.ts.map((x) => Math.abs(x - t))) }))
    .filter((f) => f.d <= PLATE_TOLERANCE_MM)
    .sort((a, b) => (alloy ? rank(a.i) - rank(b.i) || a.d - b.d : a.d - b.d || rank(a.i) - rank(b.i)))[0]?.i;
  if (close) return close;
  const extra = THICKER_MM[category] ?? THICKER_SHEET_MM;
  const thicker = plates
    .map((p) => ({ i: p.i, d: Math.min(...p.ts.map((x) => (x > t ? x - t : Infinity))) }))
    .filter((f) => f.d <= extra)
    .sort((a, b) => a.d - b.d || rank(a.i) - rank(b.i))[0]?.i;
  if (thicker || !round) return thicker;
  // Rounded to nearest: the nearest thicker plate (faced down), else the nearest thinner one.
  const nearest = (side: 1 | -1) =>
    plates
      .flatMap((p) => p.ts.filter((x) => side * (x - t) > 0 && Math.abs(x - t) <= t * ROUND_TO_NEAREST).map((x) => ({ i: p.i, x, d: Math.abs(x - t) })))
      .sort((a, b) => a.d - b.d || rank(a.i) - rank(b.i))[0];
  const near = nearest(1) ?? nearest(-1);
  return near && rounded(near.i, `${r2(near.x)} mm plate (part is ${r2(t)} mm)`);
}

// "25×50×1.5mm", "50x25mm 1.5mm wall", "Aluminum 25x1.5 tube": the numbers in a size.
const dims = (s: string) => [...s.matchAll(/(\d+(?:\.\d+)?)\s*(?=[x×]|mm|$|\s)/gi)].map((m) => Number(m[1]));

function boxDims(i: StockItem): { a: number; b: number; wall?: number } | undefined {
  const pair = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?/;
  // A size spec of one number ("50") is a square tube; the name usually has the full size.
  const size = pair.exec(i.specs.size ?? "") ?? pair.exec(i.name);
  const fromName = /[x×]\s*\d+(?:\.\d+)?\s*[x×]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*mm\s*wall/i.exec(i.name);
  const wall = num(i.specs.wall) ?? (size?.[3] ? Number(size[3]) : fromName ? Number(fromName[1] ?? fromName[2]) : undefined);
  const square = num(i.specs.size);
  if (!size) return square !== undefined ? { a: square, b: square, wall } : undefined;
  const [a, b] = [Number(size[1]), Number(size[2])].sort((x, y) => x - y);
  return { a, b, wall };
}

function roundDims(i: StockItem): { od: number; wall?: number } | undefined {
  const od = num(i.specs.od);
  const m = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*tube/i.exec(i.name) ?? /Ø\s*(\d+(?:\.\d+)?)/.exec(i.name);
  const o = od ?? (m ? Number(m[1]) : undefined);
  if (o === undefined) return undefined;
  return { od: o, wall: num(i.specs.wall) ?? (m && m[2] ? Number(m[2]) : undefined) };
}

// The best tube among `cands` (each with its outside-size gap and wall): the wall measured on
// the part matches within tolerance; an item that names no wall is the fallback.
function bestTube<T extends { i: StockItem; gap: number; wall?: number; size: string }>(cands: T[], wall: number | undefined, part?: { size: number; text: string }) {
  const exact = exactTube(cands, wall);
  if (exact || !part) return exact;
  // Rounded to nearest: by the outside size, then the wall.
  const near = cands
    .filter((c) => c.gap <= part.size * ROUND_TO_NEAREST)
    .sort((a, b) => a.gap - b.gap || (wall === undefined ? 0 : Math.abs((a.wall ?? Infinity) - wall) - Math.abs((b.wall ?? Infinity) - wall)))[0];
  return near && rounded(near.i, `${near.size} tube (part is ${part.text})`);
}

function exactTube<T extends { i: StockItem; gap: number; wall?: number }>(cands: T[], wall: number | undefined) {
  const scored = cands.flatMap((c) => {
    if (c.gap > TUBE_TOLERANCE_MM) return [];
    if (wall === undefined) return [{ c, s: c.gap + (c.wall === undefined ? 0 : 0.5) }];
    if (c.wall === undefined) return [{ c, s: 10 + c.gap }];
    const dw = Math.abs(c.wall - wall);
    return dw <= WALL_TOLERANCE_MM ? [{ c, s: dw + c.gap }] : [];
  });
  return scored.sort((a, b) => a.s - b.s)[0]?.c.i;
}

export function boxTubeFor(d1: number, d2: number, wall: number | undefined, fam: string, stock: StockItem[]) {
  const cands = stock.flatMap((i) => {
    const d = i.category === "square-tubes" && itemFamily(i) === fam ? boxDims(i) : undefined;
    return d ? [{ i, gap: Math.max(Math.abs(d.a - d1), Math.abs(d.b - d2)), wall: d.wall, size: `${r2(d.a)}×${r2(d.b)} mm` }] : [];
  });
  return bestTube(cands, wall, { size: Math.max(d1, d2), text: `${r2(d1)}×${r2(d2)} mm` });
}

// `fam` undefined: any material (a part Onshape gives no material).
export function roundTubeFor(od: number, wall: number | undefined, fam: string | undefined, stock: StockItem[]) {
  const cands = stock.flatMap((i) => {
    const d = (i.category === "round-tubes" || i.category === "carbon-tubes") && (!fam || itemFamily(i) === fam) ? roundDims(i) : undefined;
    return d ? [{ i, gap: Math.abs(d.od - od), wall: d.wall, size: `${r2(d.od)} mm` }] : [];
  });
  return bestTube(cands, wall, { size: od, text: `${r2(od)} mm` });
}

// The hex shaft item: 3/8" or 1/2" by the flats, ThunderHex when the corners are rounded (or the
// part's name says so); the other kind of the same size when inventory lacks it.
export function hexShaftFor(flats: number, thunder: boolean, stock: StockItem[]) {
  const size = flats < 11 ? '3/8"' : '1/2"';
  const shafts = stock.filter((i) => i.category === "shafts");
  const has = (i: StockItem, kind: string) => (i.specs.profile ?? i.name).toLowerCase().includes(`${size} ${kind}`.toLowerCase());
  const [want, other] = thunder ? ["ThunderHex", "Hex"] : ["Hex", "ThunderHex"];
  return shafts.find((i) => has(i, want)) ?? shafts.find((i) => has(i, other));
}

// Lathe stock: the thinnest cylinder of the part's material at least as thick as it; else the
// material's cylinder that names no size ("Brass cylinder").
export function cylinderFor(d: number, fam: string | undefined, stock: StockItem[]) {
  const cylinders = stock
    .filter((i) => i.category === "cylinders-blocks" && !/block/i.test(i.specs.shape ?? i.name) && (!fam || itemFamily(i) === fam))
    .map((i) => ({ i, od: num(i.specs.od) ?? (/Ø\s*(\d+(?:\.\d+)?)/.exec(i.name) ? Number(/Ø\s*(\d+(?:\.\d+)?)/.exec(i.name)![1]) : undefined) }));
  const sized = cylinders
    .filter((c): c is { i: StockItem; od: number } => c.od !== undefined && c.od >= d - 0.1 && c.od <= d + 10)
    .sort((a, b) => a.od - b.od)[0]?.i;
  if (sized) return sized;
  // Rounded to nearest: the closest sized cylinder within 20%.
  const near = cylinders
    .filter((c): c is { i: StockItem; od: number } => c.od !== undefined && Math.abs(c.od - d) <= d * ROUND_TO_NEAREST)
    .sort((a, b) => Math.abs(a.od - d) - Math.abs(b.od - d))[0];
  if (near) return rounded(near.i, `Ø${r2(near.od)} mm rod (part is Ø${r2(d)} mm)`);
  return fam ? cylinders.find((c) => c.od === undefined)?.i : undefined;
}

// Billet: the smallest block of the part's material it fits in; else the material's block item
// that names no size ("Aluminum block": the shop cuts it to size).
export function blockFor(size: [number, number, number], fam: string | undefined, stock: StockItem[]) {
  const blocks = stock
    .filter((i) => i.category === "cylinders-blocks" && /block/i.test(i.specs.shape ?? i.name) && (!fam || itemFamily(i) === fam))
    .map((i) => {
      const xyz = [num(i.specs.x), num(i.specs.y), num(i.specs.z)];
      const s = xyz.every((v) => v !== undefined) ? (xyz as number[]) : dims(i.name).slice(0, 3);
      return { i, s: s.length === 3 ? [...s].sort((a, b) => a - b) : undefined };
    });
  const sized = blocks
    .filter((c): c is { i: StockItem; s: number[] } => !!c.s && c.s.every((v, k) => v >= size[k] - 0.1 && v <= size[k] + 25))
    .sort((a, b) => a.s[0] * a.s[1] * a.s[2] - b.s[0] * b.s[1] * b.s[2])[0]?.i;
  return sized ?? (fam ? blocks.find((c) => !c.s)?.i : undefined);
}

// The Raw Stock item an old free-text material names ("6.7mm 6061-T6", "1/2In HEX Shaft",
// "Box tube 25×25×1.5mm", "Brass Block"): parts set up before materials were inventory items.
export function stockFromText(text: string, stock: StockItem[]): StockItem | undefined {
  const fam = family(text);
  if (/hex/i.test(text) && /shaft|stock/i.test(text)) {
    const flats = /3\/8/.test(text) ? 9.5 : /1\/2/.test(text) ? 12.7 : undefined;
    if (flats) return hexShaftFor(flats, /thunder|round/i.test(text), stock);
  }
  const box = /(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/.exec(text);
  if (box && /box|tube|profile/i.test(text)) {
    const [a, b] = [Number(box[1]), Number(box[2])].sort((x, y) => x - y);
    return boxTubeFor(a, b, Number(box[3]), fam === "carbon" ? "carbon" : "aluminum", stock);
  }
  if (/\bblock\b|billet/i.test(text)) return blockFor([0, 0, 0], fam ?? "aluminum", stock);
  const t = plateThicknessMm(text) ?? (/(\d+(?:\.\d+)?)\s*mm\b/i.exec(text) ? Number(/(\d+(?:\.\d+)?)\s*mm\b/i.exec(text)![1]) : undefined);
  const category = fam ? PLATE_CATEGORY[fam] : undefined;
  return category && t !== undefined ? plateFor(category, t, stock, ALLOY.exec(text)?.[1]) : undefined;
}

// Hex stock by its bounding box alone (parts measured before shapes were read): flat to flat
// 1/2" or 3/8", corner to corner ~1.15× that (ThunderHex's rounded corners ~1.09×).
function hexFromBox(bbox: [number, number, number]) {
  const [a, b, len] = bbox;
  const flats = Math.abs(a - 12.7) <= 0.3 ? 12.7 : Math.abs(a - 9.525) <= 0.3 ? 9.525 : undefined;
  const ratio = b / a;
  if (!flats || ratio < 1.05 || ratio > 1.18 || len < a) return undefined;
  return { flats, thunder: ratio < 1.13 };
}

// ---------- what the part is ----------

type Plan = {
  kind: "print" | "hex" | "box-tube" | "round-tube" | "rod" | "spacer" | "plate" | "bent" | "block";
  item?: StockItem;
  material?: string; // a print's plain material ("PLA"), set instead of an item
  set?: ProcessSet; // processes the shape decides
  fixed?: boolean; // `set` wins over the team default
  category?: string; // inventory category for the team default when no item matched
  why: string;
};

// The part's material text: Onshape's material, and the part's material when it isn't an
// inventory item (a BOM synced without a material column copies Onshape's material in).
function materialText(part: SetupInput, stock: StockItem[]) {
  const own = part.material && !part.inventoryItemId && !stock.some((i) => i.name === part.material) ? part.material : "";
  return `${part.geometry?.onshapeMaterial ?? ""} ${own}`.trim();
}

// A pocketed plate can read as a box tube (its pocket floors look like walls): a real tube's
// sides are both 10 mm or more and within 5× of each other (Harel, 2026-11-06: 6.7 mm plates were
// suggested as "box tube 6.7×241 mm").
function readShape(s: Shape | undefined): Shape | undefined {
  if (s?.kind !== "box-tube" || !s.d1 || !s.d2) return s;
  const [a, b] = [Math.min(s.d1, s.d2), Math.max(s.d1, s.d2)];
  if (a >= 10 && b / a <= 5) return s;
  return { kind: "plate", t: a, d1: b, d2: s.length, pocketed: s.wall !== undefined && s.wall < a * 0.8 };
}

const KIND_OF_CATEGORY: Record<string, Plan["kind"]> = { shafts: "hex", "square-tubes": "box-tube", "round-tubes": "round-tube", "cylinders-blocks": "block" };

function planFor(part: SetupInput, stock: StockItem[], linked: StockItem | undefined): Plan | undefined {
  const text = materialText(part, stock) || (linked ? itemText(linked) : "");
  const plan = shapePlan(part, stock, linked, text);
  if (plan?.item || plan?.kind === "print") return plan;
  // An old free-text material on the part names its stock when the shape can't.
  const own = part.material && !part.inventoryItemId && !stock.some((i) => i.name === part.material) ? part.material : "";
  const legacy = own ? stockFromText(`${part.geometry?.onshapeMaterial ?? ""} ${own}`, stock) : undefined;
  if (!legacy) return plan;
  if (plan && (!plan.category || plan.category === legacy.category || plan.kind === "block")) return { ...plan, item: legacy, why: `${plan.why}, material "${own}"` };
  if (plan) return plan;
  const kind = KIND_OF_CATEGORY[legacy.category] ?? "plate";
  const set = kind === "hex" ? { process1: SHAPE_MACHINES.hexShaft } : kind === "block" ? { process1: SHAPE_MACHINES.block } : undefined;
  return { kind, item: legacy, category: legacy.category, set, fixed: !!set, why: `material "${own}"` };
}

function printedSpacer(why: string): Plan {
  const p = PRINT_MATERIALS.find((m) => m.material === PRINTED_SPACER.material)!;
  return { kind: "print", material: p.material, set: { process1: p.machine }, fixed: true, why };
}

function shapePlan(part: SetupInput, stock: StockItem[], linked: StockItem | undefined, text: string): Plan | undefined {
  const g = part.geometry;
  const om = text ? `Onshape material ${text}` : "no material in Onshape";
  const fam = family(text);
  const metal = METAL.test(text);

  // Rule 1: a 3D printing material is printed, and only printed.
  const print = PRINT_MATERIALS.find((p) => p.match.test(text) || (linked?.category === "filament" && p.match.test(itemText(linked))));
  if (print) {
    return { kind: "print", material: print.material, set: { process1: print.machine }, fixed: true, why: om };
  }

  const s = readShape(g?.shape);
  const name = `${part.displayName ?? ""} ${part.onshapeName ?? ""}`;
  if (s && !g?.sheetMetal) {
    // Rule 2: hex shaft, before any plate rule.
    if (s.kind === "hex" && s.d1) {
      const thunder = !!s.thunder || /thunder/i.test(name);
      const item = hexShaftFor(s.d1, thunder, stock);
      const machine = s.turned ? SHAPE_MACHINES.turned : SHAPE_MACHINES.hexShaft;
      return { kind: "hex", item, set: { process1: machine }, fixed: true, why: `hex shaft, ${fmt(s.d1)} mm across flats${s.turned ? " with turned ends" : ""}` };
    }
    // A short hex partly turned round (1691-26-421-05A, 12.7×14.7×16 mm) isn't read as a prism:
    // 1/2" or 3/8" across the flats and 1.15× that across the corners is hex stock, turned on the
    // lathe; never a plate (Harel, 2026-11-21).
    const partHex = s.kind === "block" && s.size ? hexFromBox(s.size) : undefined;
    if (partHex) {
      const item = hexShaftFor(partHex.flats, partHex.thunder || /thunder/i.test(name), stock);
      return { kind: "hex", item, set: { process1: SHAPE_MACHINES.turned }, fixed: true, why: `hex shaft, ${fmt(partHex.flats)} mm across flats, partly turned` };
    }
    // Rule 3: box and round tubes.
    if (s.kind === "box-tube" && s.d1 && s.d2 && fam !== "poly" && fam !== "wood") {
      const item = boxTubeFor(s.d1, s.d2, s.wall, fam === "carbon" ? "carbon" : "aluminum", stock);
      return { kind: "box-tube", item, category: "square-tubes", why: `box tube ${fmt(s.d1)}×${fmt(s.d2)} mm${s.wall ? `, ${fmt(s.wall)} mm wall` : ""}` };
    }
    if (s.kind === "round-tube" && s.d1 && s.d2) {
      const od = (s.d1 + s.d2) / 2;
      // A short or thick-walled round metal part (a flanged bushing, a spacer), or one in a metal
      // the shop has no tube of (brass, steel), is turned from a cylinder (Harel, 2026-11-06).
      const turned = (metal || fam === "delrin") && (fam !== "aluminum" || (s.length !== undefined && s.length < 3 * od) || (s.wall ?? 0) > od * 0.2);
      if (turned) {
        const item = cylinderFor(od, fam, stock);
        return { kind: "spacer", item, set: { process1: SHAPE_MACHINES.turned }, fixed: true, why: `${om}, round part Ø${fmt(od)} mm${s.length ? `, ${fmt(s.length)} mm long` : ""}` };
      }
      // A hex bore, a spacer's name or a short length: a printed spacer, unless Onshape says the
      // part is carbon or poly tube.
      const short = s.length !== undefined && s.length <= PRINTED_SPACER.maxLengthPerOd * od;
      const named = PRINTED_SPACER.name.exec(name)?.[0];
      if (fam !== "carbon" && fam !== "poly" && (s.bore || named || short)) {
        const what = s.bore ? `${s.bore === "hex" ? "hex" : "non-round"} bore${s.boreFlats ? ` ${fmt(s.boreFlats)} mm` : ""}` : named ? `named "${named}"` : `${fmt(s.length!)} mm long`;
        return printedSpacer(`round spacer Ø${fmt(od)} mm, ${what}`);
      }
      // No material in Onshape: whichever stock tube has the size (the carbon 16×1).
      const item = roundTubeFor(od, s.wall, fam === "carbon" || fam === "poly" ? fam : text ? "aluminum" : undefined, stock);
      return { kind: "round-tube", item, category: "round-tubes", why: `round tube Ø${fmt(od)} mm${s.wall ? `, ${fmt(s.wall)} mm wall` : ""}` };
    }
    // Rule 4: round rods, pins and standoffs, and thick round spacers, are turned.
    const turnable = metal || fam === "delrin";
    if (s.kind === "rod" && s.d1 && (turnable || !text)) {
      const item = cylinderFor(Math.max(s.d1, s.d2 ?? 0), fam, stock);
      return { kind: "rod", item, set: { process1: SHAPE_MACHINES.turned }, fixed: true, why: `${om}, round rod Ø${fmt(s.d1)} mm` };
    }
    if (s.kind === "spacer" && s.d2 && turnable) {
      const item = cylinderFor(s.d2, fam, stock);
      return { kind: "spacer", item, set: { process1: SHAPE_MACHINES.turned }, fixed: true, why: `${om}, round part Ø${fmt(s.d2)} mm, ${fmt(s.d1 ?? 0)} mm thick` };
    }
    if (s.kind === "spacer" && s.d2 && !text && PRINTED_SPACER.name.test(name)) return printedSpacer(`round spacer Ø${fmt(s.d2)} mm, ${fmt(s.d1 ?? 0)} mm thick`);
    // Rule 5: plates, with or without pockets.
    // A plate Onshape gives no material is taken as aluminum, the shop's usual plate (Harel,
    // 2026-11-06); it waits in To Review like every guess.
    const plateFam = fam ?? (text ? undefined : "aluminum");
    if (s.kind === "plate" && s.t && plateFam && PLATE_CATEGORY[plateFam]) {
      const category = PLATE_CATEGORY[plateFam];
      const alloy = ALLOY.exec(text)?.[1];
      // Rounded to nearest only on a part the shape reader saw as a plate.
      const item = plateFor(category, s.t, stock, alloy, true);
      const thick = `${fmt(s.t)} mm thick`;
      const what = fam ? om : "no material in Onshape, taken as aluminum";
      if (s.pocketed) return { kind: "plate", item, category, set: { process1: SHAPE_MACHINES.pocketedPlate }, fixed: true, why: `${what}, plate with pockets or steps and ${thick}` };
      return { kind: "plate", item, category, why: `${what}, flat and ${thick}` };
    }
  }

  // Hex stock its name gives ('1/2" Hex (8.087 in)', a cut shaft from the Onshape library) when
  // no shape was read.
  const hexName = /\b(1\/2|3\/8)\s*(?:"|in\b)?\s*(thunder\s*)?hex\b/i.exec(name);
  if (!s && hexName && (metal || !text) && !/\b(gear|pulley|sprocket|bearing|hub|adapter|spacer|bore)\b/i.test(name)) {
    const item = hexShaftFor(hexName[1] === "3/8" ? 9.525 : 12.7, !!hexName[2], stock);
    return { kind: "hex", item, set: { process1: SHAPE_MACHINES.hexShaft }, fixed: true, why: `named ${hexName[0]}` };
  }

  // Parts measured before shapes were read: bounding box and wall only.
  const box = g?.bbox;
  if (!s && box && !g?.sheetMetal && (metal || !text)) {
    // Hex stock: 1/2" or 3/8" across the flats, ~1.15× across the corners.
    const hex = hexFromBox(box);
    if (hex) {
      const item = hexShaftFor(hex.flats, hex.thunder || /thunder/i.test(name), stock);
      return { kind: "hex", item, set: { process1: SHAPE_MACHINES.hexShaft }, fixed: true, why: `hex shaft, ${fmt(hex.flats)} mm across flats` };
    }
  }
  if (!s && box && !g?.sheetMetal && g?.wallMm !== undefined && (metal || fam === "carbon") && box[2] >= 3 * box[1] && box[1] <= box[0] * 2.2) {
    // A long part with a thin wall and a square, 1:2 or round section is a tube, not bent sheet.
    const tubeFam = fam === "carbon" ? "carbon" : "aluminum";
    const boxItem = boxTubeFor(box[0], box[1], g.wallMm, tubeFam, stock);
    const roundItem = !boxItem && box[1] - box[0] <= 1.5 ? roundTubeFor(box[1], g.wallMm, tubeFam, stock) : undefined;
    if (roundItem) return { kind: "round-tube", item: roundItem, category: "round-tubes", why: `tube Ø${fmt(box[1])} mm, ${fmt(g.wallMm)} mm wall` };
    // Square or round can't be told from the box, so no team default without a matching item.
    return { kind: "box-tube", item: boxItem, category: boxItem ? "square-tubes" : undefined, why: `tube ${fmt(box[0])}×${fmt(box[1])} mm, ${fmt(g.wallMm)} mm wall` };
  }

  // Bent sheet (and plates measured before shapes were read).
  const t = isBent(g) ? g!.wallMm : isFlat(g?.bbox) ? g!.bbox![0] : undefined;
  if (t !== undefined && fam && PLATE_CATEGORY[fam] && (!s || isBent(g) || s.kind === "plate")) {
    const category = PLATE_CATEGORY[fam];
    const item = plateFor(category, t, stock, ALLOY.exec(text)?.[1]);
    const bent = isBent(g);
    const shape = bent ? `bent ${g?.sheetMetal ? "sheet metal" : "sheet"}` : "flat";
    // Without a shape reading, only a matched plate counts (a thick block isn't a plate).
    if (item || s) return { kind: bent ? "bent" : "plate", item, category, why: `${om}, ${shape} and ${fmt(t)} mm thick` };
  }

  // A solid part as thick as a plate the shop stocks is cut from that plate (10×18×60 from the
  // 10 mm plate), not milled from a block.
  const solid = s ? (s.kind === "block" && !s.axisymmetric && !s.roundAlong ? s.size : undefined) : box && !isBent(g) ? box : undefined;
  if (solid && fam && PLATE_CATEGORY[fam] && solid[0] <= 13) {
    const category = PLATE_CATEGORY[fam];
    const item = plateFor(category, solid[0], stock, ALLOY.exec(text)?.[1]);
    if (item) return { kind: "plate", item, category, why: `${om}, solid part ${solid.map(fmt).join("×")} mm, cut from ${fmt(solid[0])} mm plate` };
  }

  // Other metal parts: turned when round, else milled from a block.
  if (s && metal && (s.kind === "block" || s.kind === "rod" || s.kind === "spacer" || s.kind === "plate")) {
    const size = s.size ?? ([s.t ?? s.length ?? 0, s.d1 ?? 0, s.d2 ?? 0].sort((a, b) => a - b) as [number, number, number]);
    if (s.axisymmetric) {
      const item = cylinderFor(Math.max(s.d1 ?? 0, s.d2 ?? 0), fam, stock);
      return { kind: "block", item, set: { process1: SHAPE_MACHINES.turned }, fixed: true, why: `${om}, round part` };
    }
    const item = blockFor(size, fam, stock);
    return { kind: "block", item, set: { process1: SHAPE_MACHINES.block }, fixed: true, why: `${om}, solid part ${size.map(fmt).join("×")} mm` };
  }
  return undefined;
}

// ---------- processes ----------

const isPrint = (id: string | undefined) => !!id && getMachine(id)?.kind === "print";

// The team default for a material: by its item's name or material spec ("PLA" in "Bambu PLA –
// Black filament"), else by its inventory category.
function defaultProcesses(material: string, item: StockItem | undefined, category?: string): ProcessSet | undefined {
  if (DEFAULT_PROCESSES[material]) return DEFAULT_PROCESSES[material];
  const text = `${material} ${item?.specs.material ?? ""}`;
  const key = Object.keys(DEFAULT_PROCESSES).find((k) => new RegExp(`\\b${k}\\b`, "i").test(text));
  const cat = item?.category ?? category;
  return key ? DEFAULT_PROCESSES[key] : cat ? DEFAULT_PROCESSES[cat] : undefined;
}

// The team default; a free-text material with no item and no shape read (Onshape's "Aluminum -
// 6061") takes its family's plate category. A shape that names no category (a tube with no
// matching item) gets none.
function processesFor(material: string | undefined, item: StockItem | undefined, plan: Plan | undefined): { set: ProcessSet; why: string } | undefined {
  const fam = material ? family(material) : undefined;
  const set = defaultProcesses(material ?? "", item, plan ? plan.category : fam ? PLATE_CATEGORY[fam] : undefined);
  return set ? { set, why: "the team default" } : undefined;
}

// A bent part is cut flat first, then goes to the bending machine.
function withBending(set: ProcessSet): ProcessSet {
  if (set.process1 === BENDING_MACHINE || set.process2 === BENDING_MACHINE) return set;
  if (!set.process1) return { ...set, process1: BENDING_MACHINE };
  if (!set.process2) return { ...set, process2: BENDING_MACHINE };
  return set;
}

const names = (s: ProcessSet) =>
  [s.process1, s.process2]
    .filter(Boolean)
    .map((id) => getMachine(id!)?.name ?? id)
    .join(" → ");

// What the rules would set on a part, and why, or null when they can't tell. Only what's missing
// is filled: a material someone picked and processes someone set stay.
export function suggestSetup(part: SetupInput, stock: StockItem[]): { changes: SetupChanges; reason: string } | null {
  if (part.classification === "external") return null;
  const changes: SetupChanges = {};
  const why: string[] = [];

  // The material is settled when the part is linked to an item, or names a Raw Stock item.
  const linked = part.inventoryItemId ? stock.find((i) => i.id === part.inventoryItemId) : undefined;
  const named = !part.inventoryItemId && part.material && part.classification !== "cots" ? stock.find((i) => i.name === part.material) : undefined;
  const settled = !!part.inventoryItemId || !!named || (part.classification === "cots" && !!part.material && stock.some((i) => i.name === part.material));
  const plan = planFor(part, stock, linked ?? named);
  // A part someone marked COTS is only turned in-house for clear Raw Stock: plates and prints.
  if (part.classification === "cots" && plan && !["print", "plate", "bent"].includes(plan.kind)) return null;

  let item = linked ?? named;
  let material = settled ? part.material : null;
  // A print gets the plain material ("PLA"), also in place of a filament item it was linked to.
  const print = plan?.kind === "print" && plan.material && (!settled || (linked ?? named)?.category === "filament") ? plan.material : null;
  if (print) {
    item = undefined;
    material = print;
    if (part.material !== print) changes.material = print;
    if (part.inventoryItemId) changes.inventoryItemId = null;
    if (changes.material) why.push(`${plan!.why}: ${print}`);
  } else if (named) {
    changes.inventoryItemId = named.id;
    why.push(`Linked to the inventory item ${named.name}`);
  } else if (!settled && plan?.item) {
    item = plan.item;
    material = item.name;
    changes.material = material;
    changes.inventoryItemId = item.id;
    why.push(`${plan.why}: ${material}`);
    if (item.rounded) why.push(`${ROUNDED_PREFIX}${item.rounded}`);
  } else if (!settled && plan) {
    why.push(`${plan.why}${plan.category ? " (no matching item in inventory)" : ""}`);
  }
  // A free-text material (Onshape's) still picks the team default.
  material ??= part.material;

  if (!part.process1 && !part.addedProcesses?.length) {
    const p = plan?.fixed && plan.set ? { set: plan.set, why: "from its shape" } : processesFor(material ?? undefined, item, plan);
    let set = p?.set;
    // Metal is never printed; prints get nothing but the printer.
    if (set && plan && plan.kind !== "print" && [set.process1, set.process2].some(isPrint)) set = undefined;
    if (set && plan?.kind === "print") set = { process1: set.process1 };
    if (set && p) {
      const bent = plan?.kind === "bent";
      const final = bent ? withBending(set) : set;
      const proc = { process1: final.process1 ?? null, process2: final.process2 ?? null };
      if (proc.process1 || proc.process2) {
        Object.assign(changes, proc);
        if (plan?.kind === "print" && !changes.material && !settled && !why.length) why.push(plan.why);
        why.push(`${names(final)}, ${p.why}${final !== set ? ", then bent" : ""}`);
        // Sync leaves a part without processes Undefined; a part we make is in-house.
        if (part.classification === "cots" || part.classification === "undefined") changes.classification = "inhouse";
      }
    }
  }
  // A part cut from a Raw Stock item is in-house, with or without processes yet.
  if (changes.inventoryItemId && !changes.classification && (part.classification === "cots" || part.classification === "undefined")) changes.classification = "inhouse";

  if (!Object.keys(changes).length) return null;
  return { changes, reason: why.join(". ") + "." };
}

// Sorted extents in mm of a mesh in metres, smallest first.
export function sizeOf(positions: ArrayLike<number>): [number, number, number] | undefined {
  if (positions.length < 3) return undefined;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  const mm = [0, 1, 2].map((a) => Math.round((max[a] - min[a]) * 1e5) / 100).sort((x, y) => x - y);
  return mm as [number, number, number];
}

// A part's wall thickness in mm from its mesh in metres, when the part is a thin wall: flat or
// bent sheet. Rays go from the larger triangles, both ways along their normals, to the nearest
// face; on sheet most of the surface sees the opposite face at the same distance. Returns
// undefined for parts that aren't thin walls (most of the area must agree, and the wall must be
// under a quarter of the middle bounding-box side, as for flat plates).
export function wallThickness(positions: ArrayLike<number>, indices: ArrayLike<number>, maxSamples = 150): number | undefined {
  const bbox = sizeOf(positions);
  const n = Math.floor(indices.length / 3);
  if (!bbox || !n) return undefined;
  const v = (i: number) => [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
  const tris = Array.from({ length: n }, (_, t) => {
    const [a, b, c] = [v(indices[3 * t]), v(indices[3 * t + 1]), v(indices[3 * t + 2])];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(cr[0], cr[1], cr[2]);
    return { a, e1, e2, area: len / 2, normal: len ? cr.map((x) => x / len) : [0, 0, 0], centre: [0, 1, 2].map((k) => (a[k] + b[k] + c[k]) / 3) };
  });
  const total = tris.reduce((s, t) => s + t.area, 0);
  if (!total) return undefined;

  // Möller–Trumbore: distance along `dir` from `o` to triangle `t`, or Infinity.
  const hit = (o: number[], dir: number[], t: (typeof tris)[number]) => {
    const p = [dir[1] * t.e2[2] - dir[2] * t.e2[1], dir[2] * t.e2[0] - dir[0] * t.e2[2], dir[0] * t.e2[1] - dir[1] * t.e2[0]];
    const det = t.e1[0] * p[0] + t.e1[1] * p[1] + t.e1[2] * p[2];
    if (Math.abs(det) < 1e-18) return Infinity;
    const s = [o[0] - t.a[0], o[1] - t.a[1], o[2] - t.a[2]];
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
    if (u < 0 || u > 1) return Infinity;
    const q = [s[1] * t.e1[2] - s[2] * t.e1[1], s[2] * t.e1[0] - s[0] * t.e1[2], s[0] * t.e1[1] - s[1] * t.e1[0]];
    const w = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) / det;
    if (w < 0 || u + w > 1) return Infinity;
    const d = (t.e2[0] * q[0] + t.e2[1] * q[1] + t.e2[2] * q[2]) / det;
    return d > 1e-7 ? d : Infinity;
  };

  const samples = [...tris].filter((t) => t.area > 0).sort((x, y) => y.area - x.area).slice(0, maxSamples);
  const found: { d: number; area: number }[] = [];
  for (const s of samples) {
    let best = Infinity;
    for (const dir of [s.normal, s.normal.map((x) => -x)]) {
      for (const t of tris) if (t !== s) best = Math.min(best, hit(s.centre, dir, t));
    }
    if (best < Infinity) found.push({ d: best * 1000, area: s.area });
  }
  if (!found.length) return undefined;

  // The area-weighted median distance, and how much of the sampled area agrees with it.
  found.sort((x, y) => x.d - y.d);
  const sampled = found.reduce((s, f) => s + f.area, 0);
  let acc = 0;
  const median = found.find((f) => (acc += f.area) >= sampled / 2)!.d;
  const agree = found.filter((f) => Math.abs(f.d - median) <= Math.max(0.1, median * 0.05)).reduce((s, f) => s + f.area, 0);
  if (agree < sampled * 0.6 || median > bbox[1] * 0.25) return undefined;
  return Math.round(median * 100) / 100;
}
