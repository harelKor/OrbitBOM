// Suggest setup's rules (plan §6, "Recognising part types"): material from Onshape's own
// material and the part's measured size, processes from what the team usually does with that
// material. No AI runs on the server; parts these rules can't place are left for the member's
// Claude, through the MCP server, or the designer.

import { BENDING_MACHINE, DEFAULT_PROCESSES, PLATE_TOLERANCE_MM, type ProcessSet } from "@/config/autoSetup";
import { getMachine } from "@/config/machines";
import { MATERIALS, materialCategory, plateThicknessMm } from "@/config/materials";
import type { PartGeometry } from "@/db/schema";

export type SetupInput = {
  classification: "inhouse" | "cots" | "external" | "undefined";
  material: string | null;
  preProcess: string | null;
  process1: string | null;
  process2: string | null;
  geometry: PartGeometry | null;
};

export type SetupChanges = {
  classification?: "inhouse";
  material?: string;
  preProcess?: string | null;
  process1?: string | null;
  process2?: string | null;
};

// Learned processes: the most common process set per material on the team's parts.
export type Learned = Map<string, ProcessSet & { count: number }>;

const PRINTED: [RegExp, string][] = [
  [/\bpla\b/i, "PLA"],
  [/\bonyx\b/i, "Onyx"],
  [/\bpa ?6?12\b|nylon ?12/i, "PA612"],
];

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

const isFlat = (bbox: [number, number, number] | undefined) => !!bbox && bbox[0] > 0 && bbox[0] <= bbox[1] * 0.25;

// Bent sheet: Onshape sheet metal, or a thin wall that isn't flat (an angle, a U channel). Bent
// plates use the same plate materials as flat ones.
export const isBent = (g: PartGeometry | null | undefined) => !!g && !isFlat(g.bbox) && (!!g.sheetMetal || g.wallMm !== undefined);

// The sheet thickness: the smallest side of a flat part, else the measured wall of bent sheet.
function sheetThickness(g: PartGeometry | null | undefined): number | undefined {
  if (!g) return undefined;
  if (isFlat(g.bbox)) return g.bbox![0];
  return isBent(g) ? g.wallMm : undefined;
}

// The plate of `category` whose thickness matches `t`.
function plateFor(category: string, t: number | undefined) {
  if (t === undefined) return undefined;
  return MATERIALS[category].find((m) => {
    const thk = plateThicknessMm(m);
    return thk !== undefined && Math.abs(thk - t) <= PLATE_TOLERANCE_MM;
  });
}

export function materialGuess(part: SetupInput): { material: string; why: string } | undefined {
  const om = part.geometry?.onshapeMaterial ?? "";
  const t = sheetThickness(part.geometry);
  const shape = isBent(part.geometry) ? `bent ${part.geometry?.sheetMetal ? "sheet metal" : "sheet"}` : "flat";
  const thick = t !== undefined ? `${fmt(t)} mm thick` : "";
  if (/alumin/i.test(om)) {
    const m = plateFor("Aluminum Plates", t);
    if (m) return { material: m, why: `Onshape material ${om}, ${shape} and ${thick}` };
  }
  if (/polycarb/i.test(om)) {
    const m = plateFor("Polycarbonate Plates", t);
    if (m) return { material: m, why: `Onshape material ${om}, ${shape} and ${thick}` };
  }
  for (const [re, material] of PRINTED) {
    if (re.test(om)) return { material, why: `Onshape material ${om}` };
  }
  return undefined;
}

function processesFor(material: string, learned: Learned): { set: ProcessSet; why: string } | undefined {
  const team = learned.get(material);
  if (team && team.count >= 2) return { set: team, why: `as on ${team.count} other ${material} parts` };
  const set = DEFAULT_PROCESSES[material] ?? DEFAULT_PROCESSES[materialCategory(material) ?? ""];
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

// What the rules would set on a part, and why, or null when they can't tell.
export function suggestSetup(part: SetupInput, learned: Learned): { changes: SetupChanges; reason: string } | null {
  if (part.classification === "external") return null;
  const changes: SetupChanges = {};
  const why: string[] = [];

  let material = part.material;
  if (!material) {
    const guess = materialGuess(part);
    if (!guess) return null;
    material = guess.material;
    changes.material = material;
    why.push(`${guess.why}: ${material}`);
  }

  if (!part.preProcess && !part.process1 && !part.process2) {
    const p = processesFor(material, learned);
    if (p) {
      const set = isBent(part.geometry) ? withBending(p.set) : p.set;
      Object.assign(changes, { preProcess: set.preProcess ?? null, process1: set.process1 ?? null, process2: set.process2 ?? null });
      why.push(`${names(set)}, ${p.why}${set !== p.set ? ", then bent" : ""}`);
      // Sync leaves a part without processes Undefined; a part we make is in-house.
      if (part.classification === "cots" || part.classification === "undefined") changes.classification = "inhouse";
    }
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
