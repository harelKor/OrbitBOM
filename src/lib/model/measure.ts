// Onshape-style measuring on picked faces, edges and points (Harel, 2026-11-09). One pick shows
// its own size (area, diameter, length, coordinates); two show the minimum distance between them
// with its X / Y / Z, the exact distance between parallel faces, the angle, and the distance
// between hole centres. Everything is in the assembly's frame (Onshape's, Z up), metres in, mm out.
import { cross, dist, dot, len, norm, type Edge, type Face, type V3 } from "./topology";

// A column-major 4×4 (three.js Matrix4.elements): part frame → assembly frame.
export type M4 = ArrayLike<number>;
const at = (m: M4, p: V3): V3 => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
const turn = (m: M4, v: V3): V3 => norm([m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]]);

export type Picked =
  | { type: "face"; face: Face; tris: [V3, V3, V3][]; name: string }
  | { type: "edge"; edge: Edge; name: string }
  | { type: "point"; p: V3; name: string };

// A face, edge or corner of one placed part, moved into the assembly's frame.
export function placeFace(face: Face, pos: ArrayLike<number>, idx: ArrayLike<number>, m: M4, name: string): Picked {
  const P = (v: number): V3 => at(m, [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]);
  const tris = face.tris.map((t) => [P(idx[t * 3]), P(idx[t * 3 + 1]), P(idx[t * 3 + 2])] as [V3, V3, V3]);
  const placed: Face = { ...face, normal: face.normal && turn(m, face.normal), axis: face.axis && turn(m, face.axis), point: face.point && at(m, face.point) };
  return { type: "face", face: placed, tris, name };
}
export function placeEdge(edge: Edge, m: M4, name: string): Picked {
  return {
    type: "edge",
    name,
    edge: { ...edge, points: edge.points.map((p) => at(m, p)), dir: edge.dir && turn(m, edge.dir), center: edge.center && at(m, edge.center), normal: edge.normal && turn(m, edge.normal) },
  };
}
export function placePoint(p: V3, m: M4, name: string): Picked {
  return { type: "point", p: at(m, p), name };
}

export type Row = { label: string; value: string };
const mm = (m: number) => `${(m * 1000).toFixed(2)} mm`;
const mm2 = (a: number) => `${(a * 1e6).toFixed(2)} mm²`;
const deg = (r: number) => `${((r * 180) / Math.PI).toFixed(2)}°`;

// ---------- Closest points ----------

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addk = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function onSegment(p: V3, a: V3, b: V3): V3 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  return l2 ? addk(a, ab, clamp01(dot(sub(p, a), ab) / l2)) : a;
}

// The point of triangle abc nearest p (Ericson, Real-Time Collision Detection 5.1.5).
function onTriangle(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return addk(a, ab, d1 / (d1 - d3));
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return addk(a, ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return addk(b, sub(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const denom = 1 / (va + vb + vc);
  return addk(addk(a, ab, vb * denom), ac, vc * denom);
}

// The closest points of segments p1q1 and p2q2 (Ericson 5.1.9).
function segSeg(p1: V3, q1: V3, p2: V3, q2: V3): [V3, V3] {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-18 && e <= 1e-18) return [p1, p2];
  if (a <= 1e-18) t = clamp01(f / e);
  else {
    const c = dot(d1, r);
    if (e <= 1e-18) s = clamp01(-c / a);
    else {
      const b = dot(d1, d2);
      const den = a * e - b * b;
      s = den !== 0 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) [t, s] = [0, clamp01(-c / a)];
      else if (t > 1) [t, s] = [1, clamp01((b - c) / a)];
    }
  }
  return [addk(p1, d1, s), addk(p2, d2, t)];
}

type Shape = { points: V3[]; segs: [V3, V3][]; tris: [V3, V3, V3][] };
function shapeOf(x: Picked): Shape {
  if (x.type === "point") return { points: [x.p], segs: [], tris: [] };
  if (x.type === "edge") {
    const p = x.edge.points;
    const segs: [V3, V3][] = p.slice(1).map((q, i) => [p[i], q]);
    if (x.edge.closed && p.length > 2) segs.push([p[p.length - 1], p[0]]);
    return { points: p, segs, tris: [] };
  }
  const seen = new Map<string, V3>();
  for (const t of x.tris) for (const v of t) seen.set(v.join(","), v);
  return { points: [...seen.values()], segs: [], tris: x.tris };
}

// Points of A against B's shapes; long lists are thinned so a big face stays quick.
function best(A: Shape, B: Shape, flip: boolean, found: { d: number; a: V3; b: V3 }) {
  const work = B.tris.length + B.segs.length + B.points.length;
  const step = Math.max(1, Math.ceil((A.points.length * work) / 1.5e6));
  const take = (a: V3, b: V3) => {
    const d = dist(a, b);
    if (d < found.d) Object.assign(found, flip ? { d, a: b, b: a } : { d, a, b });
  };
  for (let i = 0; i < A.points.length; i += step) {
    const p = A.points[i];
    for (const t of B.tris) take(p, onTriangle(p, t[0], t[1], t[2]));
    for (const s of B.segs) take(p, onSegment(p, s[0], s[1]));
    for (const q of B.points) take(p, q);
  }
}

export function closest(x: Picked, y: Picked): { d: number; a: V3; b: V3 } {
  const A = shapeOf(x), B = shapeOf(y);
  const found = { d: Infinity, a: A.points[0], b: B.points[0] };
  best(A, B, false, found);
  best(B, A, true, found);
  // Edge against edge: their segments can pass closest between their points.
  if (A.segs.length * B.segs.length <= 1.5e6)
    for (const s of A.segs)
      for (const t of B.segs) {
        const [a, b] = segSeg(s[0], s[1], t[0], t[1]);
        const d = dist(a, b);
        if (d < found.d) Object.assign(found, { d, a, b });
      }
  return found;
}

// ---------- What a pick says ----------

const dirOf = (x: Picked): V3 | null =>
  x.type === "face" ? (x.face.normal ?? x.face.axis ?? null) : x.type === "edge" ? (x.edge.dir ?? x.edge.normal ?? null) : null;
const centreOf = (x: Picked): { c: V3; axis?: V3 } | null =>
  x.type === "face" && x.face.kind === "cylinder" ? { c: x.face.point!, axis: x.face.axis } : x.type === "edge" && x.edge.kind === "circle" ? { c: x.edge.center!, axis: x.edge.normal } : null;

export function describe(x: Picked): Row[] {
  if (x.type === "point") return [{ label: "X", value: mm(x.p[0]) }, { label: "Y", value: mm(x.p[1]) }, { label: "Z", value: mm(x.p[2]) }];
  if (x.type === "edge") {
    const e = x.edge;
    if (e.kind === "circle") {
      const rows = [{ label: "Diameter", value: mm(e.radius! * 2) }, { label: "Radius", value: mm(e.radius!) }];
      return e.closed ? rows : [...rows, { label: "Arc length", value: mm(e.length) }];
    }
    return [{ label: "Length", value: `${e.kind === "line" ? "" : "≈ "}${mm(e.length)}` }];
  }
  const f = x.face;
  if (f.kind === "cylinder") return [{ label: "Diameter", value: mm(f.radius! * 2) }, { label: "Radius", value: mm(f.radius!) }, { label: "Area", value: `≈ ${mm2(f.area)}` }];
  return [{ label: "Area", value: `${f.kind === "plane" ? "" : "≈ "}${mm2(f.area)}` }];
}

export function measure(picks: Picked[]): { rows: Row[]; line: [V3, V3] | null } {
  if (picks.length === 1) return { rows: describe(picks[0]), line: null };
  if (picks.length !== 2) return { rows: [], line: null };
  const [x, y] = picks;
  const rows: Row[] = [];
  const c = closest(x, y);
  const exact = (x.type === "point" || (x.type === "face" && x.face.kind === "plane")) && (y.type === "point" || (y.type === "face" && y.face.kind === "plane"));
  rows.push({ label: "Minimum distance", value: `${exact ? "" : "≈ "}${mm(c.d)}` });
  rows.push({ label: "ΔX", value: mm(Math.abs(c.b[0] - c.a[0])) }, { label: "ΔY", value: mm(Math.abs(c.b[1] - c.a[1])) }, { label: "ΔZ", value: mm(Math.abs(c.b[2] - c.a[2])) });
  // Parallel flat faces: the distance between their planes, exactly.
  if (x.type === "face" && y.type === "face" && x.face.kind === "plane" && y.face.kind === "plane" && Math.abs(dot(x.face.normal!, y.face.normal!)) > 0.99999) {
    rows.splice(1, 0, { label: "Normal distance", value: mm(Math.abs(dot(x.face.normal!, [y.face.point![0] - x.face.point![0], y.face.point![1] - x.face.point![1], y.face.point![2] - x.face.point![2]]))) });
  }
  // Two holes, shafts or round edges: between their centres (their axes when parallel).
  const cx = centreOf(x), cy = centreOf(y);
  if (cx && cy) {
    let d = dist(cx.c, cy.c);
    if (cx.axis && cy.axis && Math.abs(dot(cx.axis, cy.axis)) > 0.99999 && (x.type === "face" || y.type === "face")) d = len(cross([cy.c[0] - cx.c[0], cy.c[1] - cx.c[1], cy.c[2] - cx.c[2]], cx.axis));
    rows.splice(1, 0, { label: "Centre distance", value: mm(d) });
  }
  // The angle between their directions (normals, axes, lines).
  const dx = dirOf(x), dy = dirOf(y);
  if (dx && dy) {
    const a = Math.acos(Math.min(1, Math.abs(dot(dx, dy))));
    rows.push({ label: "Angle", value: a < 1e-4 ? "0° (parallel)" : deg(a) });
  }
  return { rows, line: c.d > 0 ? [c.a, c.b] : null };
}
