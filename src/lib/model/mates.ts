// Motion along the mates and rigid groups (plan/cad-mates.md), read from the assembly definition
// the model build already fetches, asked with includeMateFeatures=true: no extra Onshape call.
// Parts that Onshape keeps together (a Group, a Fastened mate, a sub-assembly's parts that no mate
// inside it lets move) become one rigid body; revolute, slider, cylindrical and pin slot mates
// become joints between two bodies, at the first mate connector; gear, rack and pinion, screw
// and linear relations tie two joints' motions together. The browser moves them
// (src/lib/model/kinematics.ts). Planar, ball and parallel mates are left out.
import type { AssemblyDefinition, AssemblyFeature, Occurrence, SubAssembly } from "./assembly";
import { walkAssembly } from "./assembly";

export type JointType = "revolute" | "slider" | "cylindrical" | "pinSlot";
// One moving mate. `a` / `b`: the bodies on its first and second mate connector's side. `f`: the
// first connector's frame at the CAD place (row-major 4×4, metres, the assembly's frame): turning
// is about its Z, sliding along its Z (a pin slot slides along its X). `lim`: Onshape's limits,
// as moves from the CAD place (radians, metres), when it has them.
export type Joint = {
  id: string;
  name: string;
  type: JointType;
  a: number;
  b: number;
  f: number[];
  lim?: { turn?: [number, number]; slide?: [number, number] };
};
// `to`'s `dof` moves by k × `from`'s `by` move: a gear (turn → turn), a rack and pinion or a screw
// (turn → slide), a linear relation (slide → slide).
export type Relation = { from: number; by: "turn" | "slide"; to: number; dof: "turn" | "slide"; k: number };
// A group's mates: each placement's body (by its place in the plan's placements; -1: none), the
// joints, the relations (joint indexes) and the bodies holding a part fixed in Onshape (each
// mechanism's base: it stays put and the rest moves from it).
export type GroupMates = { bodies: number[]; joints: Joint[]; relations?: Relation[]; fixed?: number[] };

const MOVING: Record<string, JointType> = { REVOLUTE: "revolute", SLIDER: "slider", CYLINDRICAL: "cylindrical", PIN_SLOT: "pinSlot" };
const TURNS = new Set<JointType>(["revolute", "cylindrical", "pinSlot"]);
const SLIDES = new Set<JointType>(["slider", "cylindrical", "pinSlot"]);
export const turns = (t: JointType) => TURNS.has(t);
export const slides = (t: JointType) => SLIDES.has(t);

type V3 = [number, number, number];
type CS = { origin?: number[]; xAxis?: number[]; yAxis?: number[]; zAxis?: number[] };
type MatedEntity = { matedOccurrence?: string[]; matedCS?: CS };

const v3 = (a: unknown): V3 | null => (Array.isArray(a) && a.length >= 3 && a.slice(0, 3).every((x) => typeof x === "number" && Number.isFinite(x)) ? [a[0], a[1], a[2]] : null);

// A mate connector's frame as a row-major 4×4 (its axes are the columns).
function csMatrix(cs: CS | undefined): number[] | null {
  const o = v3(cs?.origin);
  const x = v3(cs?.xAxis);
  const y = v3(cs?.yAxis);
  const z = v3(cs?.zAxis);
  if (!o || !x || !y || !z) return null;
  return [x[0], y[0], z[0], o[0], x[1], y[1], z[1], o[1], x[2], y[2], z[2], o[2], 0, 0, 0, 1];
}

export function mul(a: number[], b: number[]): number[] {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = s;
    }
  return out;
}

// The inverse of a rigid transform (rotation + translation).
export function rigidInverse(m: number[]): number[] {
  const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]; // transposed rotation
  const t = [m[3], m[7], m[11]];
  const ti = [0, 1, 2].map((i) => -(r[i * 3] * t[0] + r[i * 3 + 1] * t[1] + r[i * 3 + 2] * t[2]));
  return [r[0], r[1], r[2], ti[0], r[3], r[4], r[5], ti[1], r[6], r[7], r[8], ti[2], 0, 0, 0, 1];
}

class Sets {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) i = this.parent[i] = this.parent[this.parent[i]];
    return i;
  }
  join(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

const pathKey = (p: string[]) => p.join("/");
const startsWith = (p: string[], prefix: string[]) => prefix.every((id, i) => p[i] === id);

// What reading the limits needs: each assembly element (the root, or a sub-assembly's document,
// element and microversion) whose moving mates are in the model, and those mates' joints by
// feature id.
export type LimitAsk = { did?: string; eid?: string; microversion?: string; configuration?: string; root: boolean; joints: { featureId: string; joint: number; cad: { turn: number; slide: number } }[] };

export type ReadMates = GroupMates & { asks: LimitAsk[] };

// Every mate feature of the root and of each sub-assembly occurrence, with the path in front of
// its occurrence paths (a sub-assembly placed twice has its mates twice).
function featuresOf(def: AssemblyDefinition, occs: Occurrence[]): { prefix: string[]; feature: AssemblyFeature; sub: SubAssembly | null }[] {
  const out: { prefix: string[]; feature: AssemblyFeature; sub: SubAssembly | null }[] = [];
  for (const feature of def.rootAssembly?.features ?? []) out.push({ prefix: [], feature, sub: null });
  for (const o of occs) if (o.sub) for (const feature of o.sub.features ?? []) out.push({ prefix: o.path, feature, sub: o.sub });
  return out.filter(({ feature }) => !feature.suppressed);
}

// `placed`: the plan's placements' occurrence paths, in order.
export function readMates(def: AssemblyDefinition, placed: string[][]): ReadMates {
  const occs = walkAssembly(def);
  const parts = occs.filter((o) => o.inst.type === "Part");
  const index = new Map(parts.map((o, i) => [pathKey(o.path), i]));
  const transformOf = new Map(occs.map((o) => [pathKey(o.path), o.transform]));
  const sets = new Sets(parts.length);
  const partsUnder = (prefix: string[]) => parts.flatMap((o, i) => (startsWith(o.path, prefix) ? [i] : []));
  // Fixed in Onshape: the part's own occurrence, or a fixed sub-assembly's first part.
  const fixedParts = new Set<number>();
  for (const o of occs) {
    if (!o.fixed) continue;
    const i = o.inst.type === "Part" ? index.get(pathKey(o.path)) : partsUnder(o.path)[0];
    if (i !== undefined) fixedParts.add(i);
  }

  type Edge = { prefix: string[]; featureId: string; name: string; type: JointType; a: number; b: number; f: number[]; cad: { turn: number; slide: number }; sub: SubAssembly | null };
  const edges: Edge[] = [];
  const relations: { prefix: string[]; data: Record<string, unknown> }[] = [];
  for (const { prefix, feature, sub } of featuresOf(def, occs)) {
    const data = feature.featureData ?? {};
    const featureId = String(feature.id ?? data.id ?? "");
    if (feature.featureType === "mateGroup") {
      const members = ((data.occurrences as { occurrence?: string[] }[] | undefined) ?? []).flatMap((o) => (Array.isArray(o.occurrence) ? partsUnder([...prefix, ...o.occurrence]) : []));
      for (const m of members.slice(1)) sets.join(members[0], m);
      continue;
    }
    if (feature.featureType === "mateRelation") {
      relations.push({ prefix, data });
      continue;
    }
    if (feature.featureType !== "mate") continue;
    const ents = (data.matedEntities as MatedEntity[] | undefined) ?? [];
    if (ents.length !== 2) continue;
    const ends = ents.map((e) => (Array.isArray(e.matedOccurrence) && e.matedOccurrence.length ? index.get(pathKey([...prefix, ...e.matedOccurrence])) : undefined));
    if (ends[0] === undefined || ends[1] === undefined) continue; // a hidden-in-Onshape mate connector, a suppressed part, an assembly's own connector
    const type = data.mateType === "FASTENED" ? "fastened" : MOVING[String(data.mateType)];
    if (type === "fastened") {
      sets.join(ends[0], ends[1]);
      continue;
    }
    if (!type) continue;
    // The connectors where the parts are now: each part's transform × its connector.
    const ta = transformOf.get(pathKey(parts[ends[0]].path))!;
    const tb = transformOf.get(pathKey(parts[ends[1]].path))!;
    const ca = csMatrix(ents[0].matedCS);
    const cb = csMatrix(ents[1].matedCS);
    if (!ca || !cb) continue;
    const fa = mul(ta, ca);
    const fb = mul(tb, cb);
    // Where the second connector sits in the first one's frame: the mate's value at the CAD place.
    const rel = mul(rigidInverse(fa), fb);
    const cad = { turn: Math.atan2(rel[4], rel[0]), slide: type === "pinSlot" ? rel[3] : rel[11] };
    edges.push({ prefix, featureId, name: String(data.name ?? "Mate"), type, a: ends[0], b: ends[1], f: fa, cad, sub });
  }

  // A sub-assembly moves as one piece in its parent: whatever its own mates don't connect to its
  // main piece (parts fixed in it, unmated ones) goes with that piece. Deepest first.
  const subOccs = occs.filter((o) => o.inst.type === "Assembly").sort((x, y) => y.path.length - x.path.length);
  for (const s of subOccs) {
    const own = partsUnder(s.path);
    if (own.length < 2) continue;
    const local = new Sets(parts.length);
    for (const i of own) local.join(i, sets.find(i));
    for (const e of edges) if (startsWith(e.prefix, s.path) && own.includes(e.a) && own.includes(e.b)) local.join(sets.find(e.a), sets.find(e.b));
    const pieces = new Map<number, number[]>();
    for (const i of own) {
      const r = local.find(i);
      pieces.set(r, [...(pieces.get(r) ?? []), i]);
    }
    if (pieces.size < 2) continue;
    // Its main piece: the one with a fixed part, else the biggest.
    const sorted = [...pieces.values()].sort((x, y) => Number(y.some((i) => fixedParts.has(i))) - Number(x.some((i) => fixedParts.has(i))) || y.length - x.length);
    const main = sorted[0];
    for (const other of sorted.slice(1)) sets.join(main[0], other[0]);
  }

  // Bodies numbered in the order the placements first meet them.
  const bodyOf = new Map<number, number>();
  const body = (part: number) => {
    const r = sets.find(part);
    let b = bodyOf.get(r);
    if (b === undefined) bodyOf.set(r, (b = bodyOf.size));
    return b;
  };
  const bodies = placed.map((p) => {
    const i = index.get(pathKey(p));
    return i === undefined ? -1 : body(i);
  });

  const joints: Joint[] = [];
  const jointOf = new Map<string, number>(); // prefix + feature id → joint
  const asks = new Map<string, LimitAsk>();
  for (const e of edges) {
    const a = body(e.a);
    const b = body(e.b);
    if (a === b) continue; // locked by a Fastened mate or a Group across it
    const id = pathKey([...e.prefix, e.featureId]);
    const j = joints.push({ id, name: e.name, type: e.type, a, b, f: e.f }) - 1;
    jointOf.set(id, j);
    const key = e.sub ? `${e.sub.documentId}|${e.sub.elementId}|${e.sub.documentMicroversion ?? ""}|${e.sub.configuration ?? ""}` : "root";
    let ask = asks.get(key);
    if (!ask) asks.set(key, (ask = e.sub ? { did: e.sub.documentId, eid: e.sub.elementId, microversion: e.sub.documentMicroversion, configuration: e.sub.configuration, root: false, joints: [] } : { root: true, joints: [] }));
    ask.joints.push({ featureId: e.featureId, joint: j, cad: e.cad });
  }

  const ties: Relation[] = [];
  for (const { prefix, data } of relations) {
    const mates = ((data.mates as { featureId?: string }[] | undefined) ?? []).map((m) => jointOf.get(pathKey([...prefix, String(m.featureId ?? "")])));
    const kind = String(data.relationType ?? "");
    const sign = data.reverseDirection ? -1 : 1;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const [x, y] = mates;
    if (kind === "SCREW") {
      const len = num(data.relationLength);
      if (x !== undefined && len !== null && slides(joints[x].type) && turns(joints[x].type)) ties.push({ from: x, by: "turn", to: x, dof: "slide", k: (sign * len) / (2 * Math.PI) });
      continue;
    }
    if (x === undefined || y === undefined || x === y) continue;
    if (kind === "GEAR") {
      const ratio = num(data.relationRatio);
      if (ratio !== null && turns(joints[x].type) && turns(joints[y].type)) ties.push({ from: x, by: "turn", to: y, dof: "turn", k: sign * ratio });
    } else if (kind === "RACK_AND_PINION") {
      const len = num(data.relationLength);
      // The pinion is the mate that turns, the rack the one that slides.
      const [pin, rack] = turns(joints[x].type) && joints[y].type === "slider" ? [x, y] : [y, x];
      if (len !== null && turns(joints[pin].type) && slides(joints[rack].type)) ties.push({ from: pin, by: "turn", to: rack, dof: "slide", k: (sign * len) / (2 * Math.PI) });
    } else if (kind === "LINEAR") {
      const ratio = num(data.relationRatio);
      if (ratio !== null && slides(joints[x].type) && slides(joints[y].type)) ties.push({ from: x, by: "slide", to: y, dof: "slide", k: sign * ratio });
    }
  }

  const fixed = [...new Set([...fixedParts].map(body))];
  return { bodies, joints, ...(ties.length ? { relations: ties } : {}), ...(fixed.length ? { fixed } : {}), asks: [...asks.values()] };
}

// ---------- Limits (the assembly's features list: 1 call per assembly element asked) ----------

type Param = { parameterId?: string; value?: unknown; expression?: string; isNull?: boolean; message?: Param };
type FeatureList = { features?: { featureId?: string; parameters?: Param[]; message?: { featureId?: string; parameters?: Param[] } }[] };

const UNITS: Record<string, number> = { deg: Math.PI / 180, degree: Math.PI / 180, rad: 1, radian: 1, mm: 0.001, millimeter: 0.001, cm: 0.01, centimeter: 0.01, m: 1, meter: 1, in: 0.0254, inch: 0.0254, ft: 0.3048, foot: 0.3048 };
// "-90 deg", "1.5*in", "0.2 m": a plain number and unit (variables and formulas are skipped).
export function quantity(expression: string | undefined): number | null {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*\*?\s*([a-z]+)\s*$/i.exec(expression ?? "");
  const unit = m ? UNITS[m[2].toLowerCase().replace(/s$/, "")] : undefined;
  return m && unit !== undefined ? Number(m[1]) * unit : null;
}

// Onshape's limit parameters on a mate feature (the ids its mate dialog uses).
const LIMIT_IDS = { turn: ["limitAxialZMin", "limitAxialZMax"], slide: ["limitZMin", "limitZMax"], slot: ["limitXMin", "limitXMax"] } as const;

// The limits on the asked joints, as moves from the CAD place. Onshape measures a mate's value
// from its connectors lined up, in a direction we can't be sure of; the CAD place is always
// inside the limits, so the direction that puts it there is the one used (none fits: no limits).
export function applyLimits(joints: Joint[], ask: LimitAsk, list: FeatureList) {
  const byId = new Map((list.features ?? []).map((f) => [f.message?.featureId ?? f.featureId, f.message?.parameters ?? f.parameters ?? []]));
  for (const { featureId, joint, cad } of ask.joints) {
    const params = new Map((byId.get(featureId) ?? []).map((p) => [p.message?.parameterId ?? p.parameterId, p.message ?? p]));
    if (params.get("limitsEnabled")?.value !== true) continue;
    const j = joints[joint];
    const range = (ids: readonly [string, string], now: number, angle: boolean): [number, number] | undefined => {
      const [lo, hi] = ids.map((id) => {
        const p = params.get(id);
        return p && !p.isNull ? quantity(p.expression ?? (typeof p.value === "number" ? `${p.value} ${angle ? "rad" : "m"}` : undefined)) : null;
      });
      if (lo === null || hi === null || lo > hi) return undefined;
      const eps = angle ? 1e-3 : 1e-5;
      const wrap = (v: number) => (angle ? [v, v + 2 * Math.PI, v - 2 * Math.PI] : [v]);
      for (const s of [1, -1]) {
        const v = wrap(s * now).find((x) => x >= lo - eps && x <= hi + eps);
        // value = s × (now + q): lo ≤ s(now + q) ≤ hi
        if (v !== undefined) return s === 1 ? [lo - v, hi - v] : [v - hi, v - lo];
      }
      return undefined;
    };
    const lim: Joint["lim"] = {};
    if (turns(j.type)) lim.turn = range(LIMIT_IDS.turn, cad.turn, true);
    if (slides(j.type)) lim.slide = range(j.type === "pinSlot" ? LIMIT_IDS.slot : LIMIT_IDS.slide, cad.slide, false);
    if (lim.turn || lim.slide) j.lim = { ...(lim.turn ? { turn: lim.turn } : {}), ...(lim.slide ? { slide: lim.slide } : {}) };
  }
}
