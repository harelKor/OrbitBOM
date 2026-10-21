// What kind of stock a part is cut from, and the views and sizes its drawing needs
// (plan/auto-drawings.md): plates, square tubes, hex shafts and round tubes. Anything else
// gets no drawing.

import { type Body, type Face, type V3, cross, dot, parallel, sub, unit } from "./brep";

// `both`: the same hole is on the far side too (through both walls, or at both ends).
export type Hole = { faceId: string; at: [number, number]; d: number; both?: boolean }; // view coordinates, mm
// One orthographic view in its own millimetres, origin bottom left, x right and y up.
export type View = { w: number; h: number; lines: [number, number][][]; holes: Hole[]; axis?: boolean };

// Bumped when the reader changes, so drawings made by an older one are made again.
export const READER = 2;

export type Part = { reader?: number } & (
  | { kind: "plate"; thickness: number; front: View; side: View; minInnerRadius?: number }
  | { kind: "square-tube"; size: [number, number]; wall?: number; length: number; long: View[]; end: View; minInnerRadius?: number }
  | { kind: "hex-shaft"; acrossFlats: number; length: number; bore?: number; side: View; end: View }
  | { kind: "round-tube"; od: number; id?: number; length: number; side: View; end: View }
);

const EPS = 0.01;
const same = (a: V3, b: V3) => dot(unit(a), unit(b)) > 0.999;
const perp = (a: V3, b: V3) => Math.abs(dot(unit(a), unit(b))) < 1e-3;
const cylinders = (body: Body) => body.faces.filter((f) => f.type === "CYLINDER" && f.dir && f.radius);
const planes = (body: Body) => body.faces.filter((f) => f.type === "PLANE" && f.dir && f.out);

function range(body: Body, a: V3): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const e of body.edges)
    for (const p of e) {
      const d = dot(p, a);
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
  return [lo, hi];
}

// The view seen looking down -w with h to the right. "near" draws only the edges on the nearest
// face (all a prismatic part needs: what's behind it is hidden); "flat" draws every edge that
// lies flat in the view at any depth (a plate's outline even where it steps or thins); `box`
// adds the silhouette. Holes on the near half are drawn, marked `both` when the far half has
// one in the same place.
function view(body: Body, w: V3, h: V3, opts: { near?: boolean; flat?: boolean; box?: boolean; holes?: Face[]; axis?: boolean }): View {
  const v = cross(w, h);
  const [h0, h1] = range(body, h);
  const [v0, v1] = range(body, v);
  const [d0, d1] = range(body, w);
  const at = (p: V3): [number, number] => [dot(p, h) - h0, dot(p, v) - v0];
  const lines: [number, number][][] = [];
  const drawn = new Set<string>();
  for (const e of body.edges) {
    const depth = dot(e[0], w);
    const keep = opts.flat ? e.every((p) => Math.abs(dot(p, w) - depth) < EPS) : opts.near && e.every((p) => Math.abs(dot(p, w) - d1) < EPS);
    if (!keep) continue;
    const line = e.map(at);
    // Edges at different depths often land on the same line (a plate's top and bottom outline).
    const key = (pts: [number, number][]) => pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const k = [key(line), key([...line].reverse())].sort()[0];
    if (drawn.has(k)) continue;
    drawn.add(k);
    lines.push(line);
  }
  const [W, H] = [h1 - h0, v1 - v0];
  if (opts.box) lines.push([[0, 0], [W, 0], [W, H], [0, H], [0, 0]]);
  const mid = (d0 + d1) / 2;
  const seen = (opts.holes ?? []).filter((f) => parallel(f.dir!, w));
  const far = seen.filter((f) => dot(f.center, w) < mid - EPS);
  const holes = seen
    .filter((f) => dot(f.center, w) >= mid - EPS)
    .map((f) => {
      const p = at(f.center);
      const both = far.some((g) => Math.abs(g.radius! - f.radius!) < EPS && Math.hypot(at(g.center)[0] - p[0], at(g.center)[1] - p[1]) < 0.05);
      return { faceId: f.id, at: p, d: 2 * f.radius!, ...(both ? { both: true } : {}) };
    });
  return { w: W, h: H, lines, holes, ...(opts.axis ? { axis: true } : {}) };
}

// The direction of the longest straight edge across n, or any direction across n.
function longestAcross(body: Body, n?: V3): V3 | undefined {
  let best: V3 | undefined;
  let longest = 0;
  for (const e of body.edges) {
    if (e.length !== 2) continue;
    const d = sub(e[1], e[0]);
    const len = Math.hypot(...d);
    if (len > longest && (!n || perp(d, n))) [best, longest] = [unit(d), len];
  }
  return best;
}
const anyAcross = (n: V3) => unit(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));

const holesAndCorners = (body: Body, isAcross: (f: Face) => boolean) => {
  const cut = cylinders(body).filter((f) => f.concave && isAcross(f));
  const corners = cut.filter((f) => f.loops < 2).map((f) => f.radius!);
  return { holes: cut.filter((f) => f.loops >= 2), ...(corners.length ? { minInnerRadius: Math.min(...corners) } : {}) };
};

function readPlate(body: Body): Part | null {
  const flats = planes(body);
  const big = flats.reduce<Face | undefined>((a, b) => (!a || b.area > a.area ? b : a), undefined);
  if (!big) return null;
  const n = unit(big.dir!);
  const levels = flats.filter((f) => parallel(f.dir!, n) && f.area > big.area * 0.5).map((f) => dot(f.center, n));
  const thickness = Math.max(...levels) - Math.min(...levels);
  let u = longestAcross(body, n) ?? anyAcross(n);
  let v = cross(n, u);
  const size = (a: V3) => range(body, a)[1] - range(body, a)[0];
  if (size(v) > size(u)) [u, v] = [v, cross(n, v)]; // long side across the sheet
  if (!(thickness > 0) || thickness > 0.25 * Math.min(size(u), size(v))) return null;
  const { holes, minInnerRadius } = holesAndCorners(body, (f) => parallel(f.dir!, n));
  return {
    kind: "plate",
    thickness,
    front: view(body, n, u, { flat: true, holes }),
    side: view(body, u, n, { box: true }),
    ...(minInnerRadius ? { minInnerRadius } : {}),
  };
}

function readRound(body: Body, axis: V3): Part | null {
  const round = cylinders(body).filter((f) => parallel(f.dir!, axis));
  const outer = round.filter((f) => !f.concave).sort((a, b) => b.radius! - a.radius!)[0];
  if (!outer) return null;
  const inner = round.filter((f) => f.concave).sort((a, b) => b.radius! - a.radius!)[0];
  const across = anyAcross(axis);
  return {
    kind: "round-tube",
    od: 2 * outer.radius!,
    ...(inner ? { id: 2 * inner.radius! } : {}),
    length: range(body, axis)[1] - range(body, axis)[0],
    side: view(body, across, axis, { box: true, axis: true }),
    end: view(body, axis, across, { near: true }),
  };
}

function readHex(body: Body, axis: V3, sides: Face[]): Part {
  const flat = unit(sides[0].out!);
  const [f0, f1] = range(body, flat);
  const bores = cylinders(body).filter((f) => f.concave && parallel(f.dir!, axis) && f.loops >= 2);
  const bore = bores[0];
  return {
    kind: "hex-shaft",
    acrossFlats: f1 - f0,
    length: range(body, axis)[1] - range(body, axis)[0],
    ...(bore ? { bore: 2 * bore.radius! } : {}),
    side: view(body, flat, axis, { near: true, box: true }),
    // End on, flats top and bottom.
    end: view(body, axis, cross(flat, axis), { near: true, holes: bores }),
  };
}

function readSquare(body: Body, axis: V3, sides: Face[]): Part {
  const d1 = unit(sides[0].out!);
  const d2 = unit(cross(axis, d1));
  const [a0, a1] = range(body, axis);
  const r1 = range(body, d1);
  const r2 = range(body, d2);
  // Inner walls face the middle of the tube; the wall is their distance from the outside.
  const mid: V3 = [0, 0, 0].map((_, i) => d1[i] * (r1[0] + r1[1]) / 2 + d2[i] * (r2[0] + r2[1]) / 2) as V3;
  let wall: number | undefined;
  for (const f of planes(body)) {
    if (!perp(f.dir!, axis) || dot(f.out!, sub(mid, f.center)) <= 0) continue;
    const d = parallel(f.dir!, d1) ? d1 : d2;
    const [lo, hi] = d === d1 ? r1 : r2;
    const at = dot(f.center, d);
    const t = Math.min(hi - at, at - lo);
    if (t > 0 && (wall === undefined || t < wall)) wall = t;
  }
  const { holes, minInnerRadius } = holesAndCorners(body, (f) => perp(f.dir!, axis));
  // One long view per drilled face, the face with the most holes first. A face whose holes all
  // go through to a face already shown needs no view of its own.
  const faces: { w: V3; holes: Face[] }[] = [];
  for (const h of holes) {
    const w = unit(h.dir!);
    const outward: V3 = dot(sub(h.center, mid), w) < 0 ? [-w[0], -w[1], -w[2]] : w;
    const face = faces.find((f) => same(f.w, outward)) ?? faces[faces.push({ w: outward, holes: [] }) - 1];
    face.holes.push(h);
  }
  faces.sort((a, b) => b.holes.length - a.holes.length);
  const long: View[] = [];
  const shown: V3[] = [];
  for (const f of faces) {
    const opposite = shown.find((w) => same(w, [-f.w[0], -f.w[1], -f.w[2]]));
    if (opposite && view(body, opposite, axis, { holes }).holes.filter((h) => h.both).length >= f.holes.length) continue;
    shown.push(f.w);
    long.push(view(body, f.w, axis, { near: true, box: true, holes }));
  }
  if (!long.length) long.push(view(body, d1, axis, { near: true, box: true, holes }));
  // Holes along the axis (tapped ends) show on the end view, looking at the end that has them.
  const ends = cylinders(body).filter((f) => f.concave && f.loops >= 2 && parallel(f.dir!, axis));
  const atFar = ends.filter((f) => dot(f.center, axis) < (a0 + a1) / 2).length;
  const endW: V3 = atFar > ends.length - atFar ? [-axis[0], -axis[1], -axis[2]] : axis;
  return {
    kind: "square-tube",
    size: [r1[1] - r1[0], r2[1] - r2[0]],
    ...(wall ? { wall } : {}),
    length: a1 - a0,
    long,
    end: view(body, endW, d1, { near: true, holes: ends }),
    ...(minInnerRadius ? { minInnerRadius } : {}),
  };
}

export function readPart(body: Body): Part | null {
  const part = readKind(body);
  return part && { ...part, reader: READER };
}

function readKind(body: Body): Part | null {
  const biggest = body.faces.reduce<Face | undefined>((a, b) => (!a || b.area > a.area ? b : a), undefined);
  if (!biggest) return null;
  if (biggest.type === "CYLINDER" && !biggest.concave) return readRound(body, unit(biggest.dir!));
  const plate = readPlate(body);
  if (plate) return plate;
  const axis = longestAcross(body);
  if (!axis) return null;
  const sides = planes(body).filter((f) => perp(f.dir!, axis));
  const outward = sides.filter((f) => {
    const [lo, hi] = range(body, unit(f.out!));
    return Math.abs(dot(f.center, unit(f.out!)) - hi) < EPS && hi > lo;
  });
  const dirs: V3[] = [];
  for (const f of outward) if (!dirs.some((d) => same(d, f.out!))) dirs.push(unit(f.out!));
  if (dirs.length === 6) return readHex(body, axis, outward);
  if (dirs.length === 4) return readSquare(body, axis, outward);
  return null;
}
