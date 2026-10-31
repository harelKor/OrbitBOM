// A plate laid flat (no Onshape calls): from its cached 3D mesh (the .obm triangles, Part Studio
// coordinates), the frame that un-tilts it onto its flat back face with any pockets facing up,
// and its through-cut outline in that frame. Used by the flat DXF export and by To Fab's batch
// layout (which nests the outlines and places the parts with `matrix`).
//
// The flat frame: x along the plate's long side, y across it, z up out of the back face. The back
// face sits on z = 0, the part's lowest corner at x = y = 0. (u, v, n) is right-handed, so the
// part is never mirrored.

export type P2 = [number, number];
export type P3 = [number, number, number];

export type FlatPlate = {
  thickness: number; // mm
  size: P2; // the outline's width (x, the long side) and height (y), mm
  // Part Studio mm → flat mm, row-major 4×4: p' = R·p + t. `matrixMeters` is the same in metres
  // (Onshape's assembly transforms).
  matrix: number[];
  matrixMeters: number[];
  u: P3;
  v: P3;
  n: P3; // up: from the back face toward the pockets
  flipped: boolean; // the pockets were on the side the largest face's normal points away from
  // Through-cut loops on the back face, flat mm. Outer loops counter-clockwise, holes clockwise.
  loops: { pts: P2[]; hole: boolean }[];
};

const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: P3): P3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const neg = (a: P3): P3 => [-a[0], -a[1], -a[2]];

const FLAT_COS = 0.9999; // a facet this parallel to the plate lies in one of its planes (~0.8°)
const LEVEL_TOL = 0.02; // mm: facets this close in depth are the same plane

// `positions` are in metres (Onshape's tessellation) unless `scale` says otherwise.
export function flattenMesh(positions: ArrayLike<number>, indices: ArrayLike<number>, scale = 1000): FlatPlate | null {
  const nv = Math.floor(positions.length / 3);
  if (nv < 3 || indices.length < 3) return null;
  const P: P3[] = new Array(nv);
  for (let i = 0; i < nv; i++) P[i] = [positions[3 * i] * scale, positions[3 * i + 1] * scale, positions[3 * i + 2] * scale];

  // Every facet's normal (from its winding) and area.
  type Tri = { a: number; b: number; c: number; n: P3; area: number };
  const tris: Tri[] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    if (a >= nv || b >= nv || c >= nv) continue;
    const cr = cross(sub(P[b], P[a]), sub(P[c], P[a]));
    const len = Math.hypot(...cr);
    if (len < 1e-12) continue;
    tris.push({ a, b, c, n: [cr[0] / len, cr[1] / len, cr[2] / len], area: len / 2 });
  }
  if (!tris.length) return null;

  // The plate's normal: the direction (either sign) with the most flat area facing along it.
  const buckets = new Map<string, number>();
  const canon = (n: P3): P3 => {
    const s = Math.abs(n[0]) > 1e-6 ? Math.sign(n[0]) : Math.abs(n[1]) > 1e-6 ? Math.sign(n[1]) : Math.sign(n[2]) || 1;
    return [n[0] * s, n[1] * s, n[2] * s];
  };
  let bestKey = "";
  let bestArea = 0;
  for (const t of tris) {
    const c = canon(t.n);
    const key = c.map((x) => Math.round(x * 50)).join(",");
    const area = (buckets.get(key) ?? 0) + t.area;
    buckets.set(key, area);
    if (area > bestArea) [bestKey, bestArea] = [key, area];
  }
  const rough = unit(bestKey.split(",").map(Number) as P3);
  // Refined: the area-weighted mean of every facet close to it, signs lined up.
  let acc: P3 = [0, 0, 0];
  for (const t of tris) {
    const d = dot(t.n, rough);
    if (Math.abs(d) < 0.999) continue;
    const s = d > 0 ? t.area : -t.area;
    acc = [acc[0] + t.n[0] * s, acc[1] + t.n[1] * s, acc[2] + t.n[2] * s];
  }
  let n = unit(acc);

  // Planes across n, by depth: their area and their area facing +n (by the facets' winding).
  const flat = tris.filter((t) => Math.abs(dot(t.n, n)) > FLAT_COS);
  const depthOf = (t: Tri) => (dot(P[t.a], n) + dot(P[t.b], n) + dot(P[t.c], n)) / 3;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of P) {
    const d = dot(p, n);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  const thickness = hi - lo;
  if (!(thickness > 0)) return null;
  const facingUp = (at: number) => flat.reduce((s, t) => (Math.abs(depthOf(t) - at) < LEVEL_TOL ? s + t.area * Math.sign(dot(t.n, n)) : s), 0);
  const areaAt = (at: number) => flat.reduce((s, t) => (Math.abs(depthOf(t) - at) < LEVEL_TOL ? s + t.area : s), 0);
  // The top plane's material is below it, so its facets face +n: that tells the winding's sign.
  const wind = Math.sign(facingUp(hi) - facingUp(lo)) || 1;

  // Pockets up: floors between the two outer planes face the side their pocket opens to. With no
  // floors, the side with more flat area (the other one lost it to chamfers or cuts) goes down.
  let vote = 0;
  for (const t of flat) {
    const d = depthOf(t);
    if (d > lo + LEVEL_TOL && d < hi - LEVEL_TOL) vote += t.area * Math.sign(dot(t.n, n)) * wind;
  }
  const bottomArea = areaAt(lo);
  const topArea = areaAt(hi);
  const flipped = vote < -1e-6 || (Math.abs(vote) <= 1e-6 && topArea > bottomArea * 1.001);
  if (flipped) {
    n = neg(n);
    [lo, hi] = [-hi, -lo];
  }

  // The back face's facets, and the edges only one of them uses: its outline and holes.
  const back = flat.filter((t) => Math.abs(depthOf(t) - lo) < LEVEL_TOL);
  if (!back.length) return null;
  const key = (i: number) => P[i].map((x) => Math.round(x * 1000)).join(",");
  const keyIdx = new Map<string, number>(); // merge vertices repeated across faces
  const id = (i: number) => {
    const k = key(i);
    let v = keyIdx.get(k);
    if (v === undefined) keyIdx.set(k, (v = i));
    return v;
  };
  const uses = new Map<string, number>();
  const directed: [number, number][] = [];
  for (const t of back) {
    const [a, b, c] = [id(t.a), id(t.b), id(t.c)];
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const k = p < q ? `${p}|${q}` : `${q}|${p}`;
      uses.set(k, (uses.get(k) ?? 0) + 1);
      directed.push([p, q]);
    }
  }
  const boundary = directed.filter(([p, q]) => uses.get(p < q ? `${p}|${q}` : `${q}|${p}`) === 1);
  const next = new Map<number, number[]>();
  for (const [p, q] of boundary) next.set(p, [...(next.get(p) ?? []), q]);
  const loops3: number[][] = [];
  for (;;) {
    const start = [...next.keys()].find((k) => next.get(k)!.length);
    if (start === undefined) break;
    const loop = [start];
    let at = start;
    for (let guard = 0; guard < boundary.length + 1; guard++) {
      const outs = next.get(at);
      const to = outs?.pop();
      if (to === undefined || to === start) break;
      loop.push(to);
      at = to;
    }
    if (loop.length >= 3) loops3.push(loop);
  }
  if (!loops3.length) return null;

  // The level direction: a side of the smallest rectangle around the outline.
  const e1 = unit(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const e2 = cross(n, e1);
  const all = loops3.flat().map((i): P2 => [dot(P[i], e1), dot(P[i], e2)]);
  const [c, s] = levelAngle(all);
  let u = unit([e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s]);
  let v = cross(n, u);
  const extent = (a: P3) => {
    let mn = Infinity;
    let mx = -Infinity;
    for (const i of loops3.flat()) {
      const d = dot(P[i], a);
      if (d < mn) mn = d;
      if (d > mx) mx = d;
    }
    return [mn, mx] as const;
  };
  if (extent(v)[1] - extent(v)[0] > extent(u)[1] - extent(u)[0] + 1e-6) [u, v] = [v, cross(n, v)];
  const [x0, x1] = extent(u);
  const [y0, y1] = extent(v);

  const to2 = (i: number): P2 => [dot(P[i], u) - x0, dot(P[i], v) - y0];
  const raw = loops3.map((l) => l.map(to2));
  const loops = raw.map((pts, i) => {
    const inside = raw.filter((o, j) => j !== i && pointIn(pts[0], o)).length;
    const hole = inside % 2 === 1;
    const ccw = signedArea(pts) > 0;
    return { pts: ccw === hole ? [...pts].reverse() : pts, hole };
  });
  loops.sort((a, b) => Number(a.hole) - Number(b.hole) || Math.abs(signedArea(b.pts)) - Math.abs(signedArea(a.pts)));

  const matrix = [u[0], u[1], u[2], -x0, v[0], v[1], v[2], -y0, n[0], n[1], n[2], -lo, 0, 0, 0, 1];
  const matrixMeters = matrix.map((x, i) => (i === 3 || i === 7 || i === 11 ? x / 1000 : x));
  return { thickness, size: [x1 - x0, y1 - y0], matrix, matrixMeters, u, v, n, flipped, loops };
}

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export function signedArea(pts: P2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export function pointIn([x, y]: P2, poly: P2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Andrew's monotone chain, counter-clockwise.
export function convexHull(points: P2[]): P2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const turn = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: P2[]) => {
    const out: P2[] = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], p) <= 1e-9) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

// The direction (cos, sin) of a side of the smallest rectangle around the points. Where sides
// tie (a square, a right-angle gusset's legs and its slope), the longest hull side wins.
export function levelAngle(points: P2[]): P2 {
  const hull = convexHull(points);
  if (hull.length < 3) return [1, 0];
  const options: { c: number; s: number; area: number; len: number }[] = [];
  for (let i = 0; i < hull.length; i++) {
    const [p, q] = [hull[i], hull[(i + 1) % hull.length]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 1e-9) continue;
    const [c, s] = [(q[0] - p[0]) / len, (q[1] - p[1]) / len];
    let [a0, a1, b0, b1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [x, y] of hull) {
      const [a, b] = [x * c + y * s, -x * s + y * c];
      [a0, a1, b0, b1] = [Math.min(a0, a), Math.max(a1, a), Math.min(b0, b), Math.max(b1, b)];
    }
    options.push({ c, s, area: (a1 - a0) * (b1 - b0), len });
  }
  if (!options.length) return [1, 0];
  const least = Math.min(...options.map((o) => o.area));
  const best = options.filter((o) => o.area <= least * 1.001 + 1e-9).reduce((a, b) => (b.len > a.len ? b : a));
  return [best.c, best.s];
}

// ---- 4×4 row-major helpers for placing flat parts (layout and Onshape assemblies) ----

export const IDENTITY4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mul4(a: number[], b: number[]): number[] {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) out[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return out;
}
export const translate4 = (x: number, y: number, z = 0) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
export function rotateZ4(deg: number) {
  const r = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
