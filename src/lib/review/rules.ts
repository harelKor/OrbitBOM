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
  SHAPE_MACHINES,
  TUBE_TOLERANCE_MM,
  WALL_TOLERANCE_MM,
  type ProcessSet,
} from "@/config/autoSetup";
import { getMachine } from "@/config/machines";
import { plateThicknessMm } from "@/config/materials";
import type { PartGeometry } from "@/db/schema";

export type SetupInput = {
  classification: "inhouse" | "cots" | "external" | "undefined";
  material: string | null;
  inventoryItemId?: string | null;
  preProcess: string | null;
  process1: string | null;
  process2: string | null;
  geometry: PartGeometry | null;
  onshapeName?: string | null;
  displayName?: string | null;
};

// A Raw Stock inventory item (lib/data/materials.ts listRawStock): `category` is its inventory
// category id.
export type StockItem = { id: string; name: string; category: string; specs: Record<string, string> };

export type SetupChanges = {
  classification?: "inhouse";
  material?: string;
  inventoryItemId?: string | null; // null: a print leaves its filament item for the plain material
  preProcess?: string | null;
  process1?: string | null;
  process2?: string | null;
};

// Learned processes: the most common process set per material on the team's parts.
export type Learned = Map<string, ProcessSet & { count: number }>;

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
const num = (s: string | undefined) => (s !== undefined && s !== "" && Number.isFinite(Number(s)) ? Number(s) : undefined);

// ---------- materials ----------

const METAL = /alumin|\b(6061|7075|5052|6082)\b|brass|steel|stainless|copper|bronze|titanium/i;
const ALLOY = /\b(6061|7075|5052|6082)\b/;

// A material's family, for matching a part's Onshape material to an item's.
function family(text: string): string | undefined {
  if (/carbon(?!ate)/i.test(text)) return "carbon";
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
// plates use the same plate materials as flat ones.
const isFlat = (bbox: [number, number, number] | undefined) => !!bbox && bbox[0] > 0 && bbox[0] <= bbox[1] * 0.25;
export const isBent = (g: PartGeometry | null | undefined) => !!g && (!!g.sheetMetal || (!isFlat(g.bbox) && g.wallMm !== undefined));

// An item's plate thickness in mm: its thickness spec, else its material spec ("3mm 6061-T6"),
// else a "3mm" in its name.
function itemThickness(i: StockItem): number | undefined {
  const spec = num(i.specs.thickness);
  if (spec !== undefined) return spec;
  const fromMaterial = i.specs.material ? plateThicknessMm(i.specs.material) : undefined;
  if (fromMaterial !== undefined) return fromMaterial;
  const m = /(\d+(?:\.\d+)?)\s*mm\b/i.exec(i.name);
  return m ? Number(m[1]) : undefined;
}

// The plate in inventory category `category` closest to thickness `t`. An alloy the part names
// (7075) wins; otherwise 6061 first for aluminium.
export function plateFor(category: string, t: number | undefined, stock: StockItem[], alloy?: string) {
  if (t === undefined) return undefined;
  const fits = stock
    .filter((i) => i.category === category)
    .map((i) => ({ i, d: Math.abs((itemThickness(i) ?? Infinity) - t) }))
    .filter((f) => f.d <= PLATE_TOLERANCE_MM);
  const rank = (i: StockItem) => (alloy ? (itemText(i).includes(alloy) ? 0 : 1) : /6061/.test(itemText(i)) ? 0 : 1);
  return fits.sort((a, b) => (alloy ? rank(a.i) - rank(b.i) || a.d - b.d : a.d - b.d || rank(a.i) - rank(b.i)))[0]?.i;
}

// "25×50×1.5mm", "50x25mm 1.5mm wall", "Aluminum 25x1.5 tube": the numbers in a size.
const dims = (s: string) => [...s.matchAll(/(\d+(?:\.\d+)?)\s*(?=[x×]|mm|$|\s)/gi)].map((m) => Number(m[1]));

function boxDims(i: StockItem): { a: number; b: number; wall?: number } | undefined {
  const size = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?/.exec(i.specs.size ?? i.name);
  if (!size) return undefined;
  const [a, b] = [Number(size[1]), Number(size[2])].sort((x, y) => x - y);
  const fromName = /[x×]\s*\d+(?:\.\d+)?\s*[x×]\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*mm\s*wall/i.exec(i.name);
  const wall = num(i.specs.wall) ?? (size[3] ? Number(size[3]) : fromName ? Number(fromName[1] ?? fromName[2]) : undefined);
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
function bestTube<T extends { i: StockItem; gap: number; wall?: number }>(cands: T[], wall: number | undefined) {
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
    return d ? [{ i, gap: Math.max(Math.abs(d.a - d1), Math.abs(d.b - d2)), wall: d.wall }] : [];
  });
  return bestTube(cands, wall);
}

export function roundTubeFor(od: number, wall: number | undefined, fam: string, stock: StockItem[]) {
  const cands = stock.flatMap((i) => {
    const d = (i.category === "round-tubes" || i.category === "carbon-tubes") && itemFamily(i) === fam ? roundDims(i) : undefined;
    return d ? [{ i, gap: Math.abs(d.od - od), wall: d.wall }] : [];
  });
  return bestTube(cands, wall);
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

// Lathe stock: the thinnest cylinder of the part's material at least as thick as it.
export function cylinderFor(d: number, fam: string | undefined, stock: StockItem[]) {
  return stock
    .filter((i) => i.category === "cylinders-blocks" && !/block/i.test(i.specs.shape ?? "") && (!fam || itemFamily(i) === fam))
    .map((i) => ({ i, od: num(i.specs.od) ?? (/Ø\s*(\d+(?:\.\d+)?)/.exec(i.name) ? Number(/Ø\s*(\d+(?:\.\d+)?)/.exec(i.name)![1]) : undefined) }))
    .filter((c): c is { i: StockItem; od: number } => c.od !== undefined && c.od >= d - 0.1 && c.od <= d + 10)
    .sort((a, b) => a.od - b.od)[0]?.i;
}

// Billet: the smallest block of the part's material it fits in.
export function blockFor(size: [number, number, number], fam: string | undefined, stock: StockItem[]) {
  return stock
    .filter((i) => i.category === "cylinders-blocks" && /block/i.test(i.specs.shape ?? i.name) && (!fam || itemFamily(i) === fam))
    .map((i) => {
      const xyz = [num(i.specs.x), num(i.specs.y), num(i.specs.z)];
      const s = xyz.every((v) => v !== undefined) ? (xyz as number[]) : dims(i.name).slice(0, 3);
      return { i, s: s.length === 3 ? [...s].sort((a, b) => a - b) : undefined };
    })
    .filter((c): c is { i: StockItem; s: number[] } => !!c.s && c.s.every((v, k) => v >= size[k] - 0.1 && v <= size[k] + 25))
    .sort((a, b) => a.s[0] * a.s[1] * a.s[2] - b.s[0] * b.s[1] * b.s[2])[0]?.i;
}

// ---------- what the part is ----------

type Plan = {
  kind: "print" | "hex" | "box-tube" | "round-tube" | "rod" | "spacer" | "plate" | "bent" | "block";
  item?: StockItem;
  material?: string; // a print's plain material ("PLA"), set instead of an item
  set?: ProcessSet; // processes the shape decides
  fixed?: boolean; // `set` wins over the team's habits
  category?: string; // inventory category for the team default when no item matched
  why: string;
};

// The part's material text: Onshape's material, and the part's material when it isn't an
// inventory item (a BOM synced without a material column copies Onshape's material in).
function materialText(part: SetupInput, stock: StockItem[]) {
  const own = part.material && !part.inventoryItemId && !stock.some((i) => i.name === part.material) ? part.material : "";
  return `${part.geometry?.onshapeMaterial ?? ""} ${own}`.trim();
}

function planFor(part: SetupInput, stock: StockItem[], linked: StockItem | undefined): Plan | undefined {
  const g = part.geometry;
  const text = materialText(part, stock) || (linked ? itemText(linked) : "");
  const om = text ? `Onshape material ${text}` : "no material in Onshape";
  const fam = family(text);
  const metal = METAL.test(text);

  // Rule 1: a 3D printing material is printed, and only printed.
  const print = PRINT_MATERIALS.find((p) => p.match.test(text) || (linked?.category === "filament" && p.match.test(itemText(linked))));
  if (print) {
    return { kind: "print", material: print.material, set: { process1: print.machine }, fixed: true, why: om };
  }

  const s = g?.shape;
  const name = `${part.displayName ?? ""} ${part.onshapeName ?? ""}`;
  if (s && !g?.sheetMetal) {
    // Rule 2: hex shaft, before any plate rule.
    if (s.kind === "hex" && s.d1) {
      const thunder = !!s.thunder || /thunder/i.test(name);
      const item = hexShaftFor(s.d1, thunder, stock);
      const machine = s.turned ? SHAPE_MACHINES.turned : SHAPE_MACHINES.hexShaft;
      return { kind: "hex", item, set: { process1: machine }, fixed: true, why: `hex shaft, ${fmt(s.d1)} mm across flats${s.turned ? " with turned ends" : ""}` };
    }
    // Rule 3: box and round tubes.
    if (s.kind === "box-tube" && s.d1 && s.d2 && fam !== "poly" && fam !== "wood") {
      const item = boxTubeFor(s.d1, s.d2, s.wall, fam === "carbon" ? "carbon" : "aluminum", stock);
      return { kind: "box-tube", item, category: "square-tubes", why: `box tube ${fmt(s.d1)}×${fmt(s.d2)} mm${s.wall ? `, ${fmt(s.wall)} mm wall` : ""}` };
    }
    if (s.kind === "round-tube" && s.d1 && s.d2) {
      const od = (s.d1 + s.d2) / 2;
      const item = roundTubeFor(od, s.wall, fam === "carbon" || fam === "poly" ? fam : "aluminum", stock);
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
    // Rule 5: plates, with or without pockets.
    if (s.kind === "plate" && s.t && fam && PLATE_CATEGORY[fam]) {
      const category = PLATE_CATEGORY[fam];
      const alloy = ALLOY.exec(text)?.[1];
      const item = plateFor(category, s.t, stock, alloy);
      const thick = `${fmt(s.t)} mm thick`;
      if (s.pocketed) return { kind: "plate", item, category, set: { process1: SHAPE_MACHINES.pocketedPlate }, fixed: true, why: `${om}, plate with pockets and ${thick}` };
      return { kind: "plate", item, category, why: `${om}, flat and ${thick}` };
    }
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

  // Other metal parts: turned when round, else milled from a block.
  if (s && metal && (s.kind === "block" || s.kind === "rod" || s.kind === "spacer" || s.kind === "plate")) {
    const size = s.size ?? ([s.d1 ?? 0, s.d2 ?? 0, s.length ?? 0].sort((a, b) => a - b) as [number, number, number]);
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

function processesFor(material: string | undefined, item: StockItem | undefined, learned: Learned, category?: string): { set: ProcessSet; why: string } | undefined {
  const team = material ? learned.get(material) : undefined;
  if (team && team.count >= 2) return { set: team, why: `as on ${team.count} other ${material} parts` };
  const set = defaultProcesses(material ?? "", item, category);
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
  [s.preProcess, s.process1, s.process2]
    .filter(Boolean)
    .map((id) => getMachine(id!)?.name ?? id)
    .join(" → ");

// What the rules would set on a part, and why, or null when they can't tell. Only what's missing
// is filled: a material someone picked and processes someone set stay.
export function suggestSetup(part: SetupInput, learned: Learned, stock: StockItem[]): { changes: SetupChanges; reason: string } | null {
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
  } else if (!settled && plan) {
    why.push(`${plan.why}${plan.category ? " (no matching item in inventory)" : ""}`);
  }
  // A free-text material (Onshape's) still names the team's habits.
  material ??= part.material;

  if (!part.preProcess && !part.process1 && !part.process2) {
    const p = plan?.fixed && plan.set ? { set: plan.set, why: "from its shape" } : processesFor(material ?? undefined, item, learned, plan?.category);
    let set = p?.set;
    // Metal is never printed; prints get nothing but the printer.
    if (set && plan && plan.kind !== "print" && [set.preProcess, set.process1, set.process2].some(isPrint)) set = undefined;
    if (set && plan?.kind === "print") set = { process1: set.process1 };
    if (set && p) {
      const bent = plan?.kind === "bent" || (!plan && isBent(part.geometry));
      const final = bent ? withBending(set) : set;
      const proc = { preProcess: final.preProcess ?? null, process1: final.process1 ?? null, process2: final.process2 ?? null };
      if (proc.preProcess || proc.process1 || proc.process2) {
        Object.assign(changes, proc);
        if (plan?.kind === "print" && !changes.material && !settled && !why.length) why.push(plan.why);
        why.push(`${names(final)}, ${p.why}${final !== set ? ", then bent" : ""}`);
        // Sync leaves a part without processes Undefined; a part we make is in-house.
        if (part.classification === "cots" || part.classification === "undefined") changes.classification = "inhouse";
      }
    }
  } else if (changes.inventoryItemId && (part.classification === "cots" || part.classification === "undefined")) {
    changes.classification = "inhouse";
  }

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
