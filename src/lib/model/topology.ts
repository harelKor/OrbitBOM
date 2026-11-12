// A part's faces, edges and corners, rebuilt in the browser from its exported mesh, so the CAD
// view can pick and measure them like Onshape (plan/design-review.md, Harel 2026-11-09). The mesh
// shares vertices within one Onshape face only (mesh.ts), so a face is a connected group of
// triangles; its border segments are its edges, split where the face on the other side changes.
// Exported points lie on the true surface, so planes come out exact and round faces and edges fit
// their radius to within microns. Everything is in the part's own frame, metres.

export type V3 = [number, number, number];

export type Face = {
  tris: number[]; // triangle numbers (index / 3)
  area: number;
  kind: "plane" | "cylinder" | "other";
  normal?: V3; // plane
  point?: V3; // a point on the plane, or on the cylinder's axis
  axis?: V3; // cylinder
  radius?: number; // cylinder
};

export type Edge = {
  points: V3[]; // in order along the edge; a closed edge doesn't repeat its first point
  closed: boolean;
  faces: [number, number]; // the faces on both sides (-1: an open border)
  length: number;
  kind: "line" | "circle" | "other";
  dir?: V3; // line
  center?: V3; // circle
  normal?: V3; // circle's plane
  radius?: number; // circle
};

export type Topology = { triFace: Int32Array; faces: Face[]; edges: Edge[]; corners: V3[] };

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => {
  const l = len(a);
  return l ? mul(a, 1 / l) : [0, 0, 0];
};
export const dist = (a: V3, b: V3) => len(sub(a, b));

// A point's key, to 1 µm: two faces' copies of one edge point meet on it.
const pkey = (p: V3) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)},${Math.round(p[2] * 1e6)}`;

// The circle through three points: centre, plane normal, radius (null when in line).
function circle3(a: V3, b: V3, c: V3): { center: V3; normal: V3; radius: number } | null {
  const ab = sub(b, a);
  const ac = sub(c, a);
  const n = cross(ab, ac);
  const n2 = dot(n, n);
  if (n2 < 1e-24) return null;
  const center = add(a, mul(add(mul(cross(n, ab), dot(ac, ac)), mul(cross(ac, n), dot(ab, ab))), 1 / (2 * n2)));
  return { center, normal: norm(n), radius: dist(center, a) };
}

// Least-squares circle in 2D (Kåsa): centre and radius of points.
function circle2(pts: [number, number][]): { cx: number; cy: number; r: number } | null {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] [a b c] = [sxz syz sz]; centre (a/2, b/2).
  const m = [
    [sxx, sxy, sx, sxz],
    [sxy, syy, sy, syz],
    [sx, sy, n, sz],
  ];
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r;
    [m[i], m[p]] = [m[p], m[i]];
    if (Math.abs(m[i][i]) < 1e-30) return null;
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = m[r][i] / m[i][i];
      for (let k = i; k < 4; k++) m[r][k] -= f * m[i][k];
    }
  }
  const a = m[0][3] / m[0][0];
  const b = m[1][3] / m[1][1];
  const c = m[2][3] / m[2][2];
  const cx = a / 2;
  const cy = b / 2;
  const r2 = c + cx * cx + cy * cy;
  return r2 > 0 ? { cx, cy, r: Math.sqrt(r2) } : null;
}

// Two unit vectors at right angles to `a`.
function basis(a: V3): [V3, V3] {
  const t: V3 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(a, t));
  return [u, cross(a, u)];
}

function classifyFace(face: Face, pos: ArrayLike<number>, idx: ArrayLike<number>) {
  const P = (v: number): V3 => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const normals: V3[] = [];
  const verts = new Set<number>();
  let area = 0;
  for (const t of face.tris) {
    const a = P(idx[t * 3]), b = P(idx[t * 3 + 1]), c = P(idx[t * 3 + 2]);
    verts.add(idx[t * 3]).add(idx[t * 3 + 1]).add(idx[t * 3 + 2]);
    const n = cross(sub(b, a), sub(c, a));
    const l = len(n);
    area += l / 2;
    if (l > 1e-14) normals.push(mul(n, 1 / l));
  }
  face.area = area;
  if (!normals.length) return;
  const n0 = normals[0];
  if (normals.every((n) => dot(n, n0) > 0.99999)) {
    face.kind = "plane";
    face.normal = n0;
    face.point = P(idx[face.tris[0] * 3]);
    return;
  }
  // A cylinder: every facet normal at right angles to one axis, every point one radius from it.
  let best = n0, bestLen = 0;
  for (const n of normals) {
    const l = len(cross(n0, n));
    if (l > bestLen) [best, bestLen] = [n, l];
  }
  if (bestLen < 1e-3) return;
  const axis = norm(cross(n0, best));
  if (!normals.every((n) => Math.abs(dot(n, axis)) < 0.01)) return;
  const [u, w] = basis(axis);
  const pts = [...verts].map(P);
  const fit = circle2(pts.map((p) => [dot(p, u), dot(p, w)]));
  if (!fit) return;
  const tol = Math.max(2e-5, fit.r * 0.003);
  if (!pts.every((p) => Math.abs(Math.hypot(dot(p, u) - fit.cx, dot(p, w) - fit.cy) - fit.r) < tol)) return;
  const along = pts.reduce((s, p) => s + dot(p, axis), 0) / pts.length;
  face.kind = "cylinder";
  face.axis = axis;
  face.radius = fit.r;
  face.point = add(add(mul(u, fit.cx), mul(w, fit.cy)), mul(axis, along));
}

export function classifyEdge(e: Edge) {
  const p = e.points;
  let length = 0;
  for (let i = 1; i < p.length; i++) length += dist(p[i - 1], p[i]);
  if (e.closed && p.length > 2) length += dist(p[p.length - 1], p[0]);
  e.length = length;
  if (p.length < 2) return;
  const first = p[0];
  const last = e.closed ? p[Math.floor(p.length / 2)] : p[p.length - 1];
  const dir = norm(sub(last, first));
  const offLine = (q: V3) => len(cross(sub(q, first), dir));
  if (!e.closed && p.every((q) => offLine(q) < 1e-6)) {
    e.kind = "line";
    e.dir = dir;
    return;
  }
  if (p.length < 3) return;
  const c = circle3(p[0], p[Math.floor(p.length / 3)], p[Math.floor((2 * p.length) / 3)]);
  if (!c) return;
  const tol = Math.max(1e-5, c.radius * 0.003);
  if (!p.every((q) => Math.abs(dist(q, c.center) - c.radius) < tol && Math.abs(dot(sub(q, c.center), c.normal)) < tol)) return;
  e.kind = "circle";
  e.center = c.center;
  e.normal = c.normal;
  e.radius = c.radius;
  if (e.closed) e.length = 2 * Math.PI * c.radius;
}

export function topology(pos: ArrayLike<number>, idx: ArrayLike<number>): Topology {
  const nv = pos.length / 3;
  const nt = Math.floor(idx.length / 3);
  // Faces: vertices joined by triangles.
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]];
    return x;
  };
  for (let t = 0; t < nt; t++) {
    const a = find(idx[t * 3]);
    for (const v of [idx[t * 3 + 1], idx[t * 3 + 2]]) {
      const b = find(v);
      if (a !== b) parent[b] = a;
    }
  }
  const faceOfRoot = new Map<number, number>();
  const faces: Face[] = [];
  const triFace = new Int32Array(nt);
  for (let t = 0; t < nt; t++) {
    const r = find(idx[t * 3]);
    let f = faceOfRoot.get(r);
    if (f === undefined) {
      f = faces.length;
      faceOfRoot.set(r, f);
      faces.push({ tris: [], area: 0, kind: "other" });
    }
    faces[f].tris.push(t);
    triFace[t] = f;
  }
  for (const f of faces) classifyFace(f, pos, idx);

  // Border segments: triangle sides used once.
  const P = (v: number): V3 => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const uses = new Map<number, { a: number; b: number; n: number }>();
  for (let t = 0; t < nt; t++) {
    for (const [a, b] of [
      [idx[t * 3], idx[t * 3 + 1]],
      [idx[t * 3 + 1], idx[t * 3 + 2]],
      [idx[t * 3 + 2], idx[t * 3]],
    ]) {
      const k = a < b ? a * nv + b : b * nv + a;
      const u = uses.get(k);
      if (u) u.n++;
      else uses.set(k, { a, b, n: 1 });
    }
  }
  const vertFace = new Int32Array(nv).fill(-1);
  for (let t = 0; t < nt; t++) for (let j = 0; j < 3; j++) vertFace[idx[t * 3 + j]] = triFace[t];
  type Seg = { face: number; ka: string; kb: string; pa: V3; pb: V3; other: number };
  const segs: Seg[] = [];
  const byPair = new Map<string, Seg[]>();
  for (const { a, b, n } of uses.values()) {
    if (n !== 1) continue;
    const pa = P(a), pb = P(b);
    const ka = pkey(pa), kb = pkey(pb);
    const s: Seg = { face: vertFace[a], ka, kb, pa, pb, other: -1 };
    segs.push(s);
    const pair = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const list = byPair.get(pair) ?? [];
    list.push(s);
    byPair.set(pair, list);
  }
  for (const list of byPair.values()) for (const s of list) s.other = list.find((o) => o.face !== s.face)?.face ?? -1;

  // Edges: a face's border segments with the same face on the other side, chained; each edge
  // once (from the lower face, or the only one).
  const groups = new Map<string, Seg[]>();
  for (const s of segs) {
    if (s.other !== -1 && s.other < s.face) continue;
    const g = `${s.face}|${s.other}`;
    const list = groups.get(g) ?? [];
    list.push(s);
    groups.set(g, list);
  }
  const edges: Edge[] = [];
  const cornerKeys = new Map<string, V3>();
  for (const list of groups.values()) {
    const at = new Map<string, Seg[]>();
    for (const s of list) for (const k of [s.ka, s.kb]) at.set(k, [...(at.get(k) ?? []), s]);
    const used = new Set<Seg>();
    // Start chains at their ends (points with one segment) first, then closed loops.
    const starts = [...list].sort((x, y) => Math.min(at.get(x.ka)!.length, at.get(x.kb)!.length) - Math.min(at.get(y.ka)!.length, at.get(y.kb)!.length));
    for (const s0 of starts) {
      if (used.has(s0)) continue;
      used.add(s0);
      let startKey = at.get(s0.ka)!.length === 1 ? s0.ka : at.get(s0.kb)!.length === 1 ? s0.kb : s0.ka;
      const points: V3[] = startKey === s0.ka ? [s0.pa, s0.pb] : [s0.pb, s0.pa];
      let key = startKey === s0.ka ? s0.kb : s0.ka;
      let closed = false;
      for (;;) {
        const next = (at.get(key) ?? []).find((s) => !used.has(s));
        if (!next) break;
        used.add(next);
        const [nk, np] = next.ka === key ? [next.kb, next.pb] : [next.ka, next.pa];
        if (nk === startKey) {
          closed = true;
          break;
        }
        points.push(np);
        key = nk;
      }
      // Walk back from the start too, for a chain entered in its middle.
      if (!closed) {
        for (;;) {
          const prev = (at.get(startKey) ?? []).find((s) => !used.has(s));
          if (!prev) break;
          used.add(prev);
          const [pk, pp] = prev.ka === startKey ? [prev.kb, prev.pb] : [prev.ka, prev.pa];
          points.unshift(pp);
          startKey = pk;
        }
      }
      const edge: Edge = { points, closed, faces: [list[0].face, list[0].other], length: 0, kind: "other" };
      classifyEdge(edge);
      edges.push(edge);
      if (!closed) for (const p of [points[0], points[points.length - 1]]) cornerKeys.set(pkey(p), p);
    }
  }
  return { triFace, faces, edges, corners: [...cornerKeys.values()] };
}
