// A Fab batch's parts laid flat on a sheet (Harel, 2026-10-31: "Auto Layout"). Pure maths, used by
// the server (from the cached .obm meshes in R2, no Onshape calls) and by the layout window.
//
// flattenMesh finds a plate's flat frame: the normal N of its biggest planar faces, pointing up from
// the flat back face (Z = 0, the spoilboard side) toward the pocketed face, and U along the longest
// side of its minimum-area rectangle, V = N × U (right-handed, so a part is never mirrored).
// nestParts packs every copy on a sheet (MaxRects, bottom-left, 90° turns) with a gap between parts
// and a margin around the sheet.
//
// Frames: a copy's pose on the sheet is T(x, y, 0) · Rz(rotation) · flatten, all in millimetres,
// where (x, y) is where its flat-frame origin lands. In the flat frame the part's bounding box runs
// from (0, 0) to (w, h).

export type Pt = [number, number];
export type Mat4 = number[]; // 16 numbers, row-major, translation in mm

export type FlatGeom = {
  w: number; // mm, along U (the longer side)
  h: number; // mm, along V
  thickness: number; // mm, along N
  outline: Pt[]; // outer loop in the flat frame (mm), counter-clockwise
  holes: Pt[][]; // inner loops of the back face
  flatten: Mat4; // Part Studio (mm) → flat frame
  plate: boolean; // thin enough to be a plate
  down: [number, number, number]; // the face on the sheet: its outward normal, Part Studio axes
};

// `sheetMetal`: an Onshape sheet metal part, laid out as its flat pattern.
export type FlatPart = FlatGeom & { partId: string; name: string; quantity: number; sheetMetal?: boolean };

export type Rotation = number; // degrees about Z
export type Placement = { partId: string; copy: number; x: number; y: number; rotation: Rotation };

export type NestOptions = { sheetW: number; sheetH?: number; gap?: number; margin?: number };
export type Nest = {
  placements: Placement[];
  width: number; // the nested parts' bounding box, mm (without the margin)
  height: number;
  unplaced: { partId: string; copy: number }[];
};

export const DEFAULT_GAP = 8;
export const DEFAULT_MARGIN = 10;
export const DEFAULT_SHEET_W = 600;

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];

// ---------- the flat frame ----------

const PLANE_TOL = 0.05; // mm: a triangle on the top or bottom plane
const MAX_CLUSTERS = 400;

// `positions` in metres (the .obm file), as Onshape's Part Studio places the part. `down`: the
// outward normal (Part Studio axes) of the face a member chose to lay on the sheet (the layout
// window's 3D preview, Flip or a clicked face); without it the side with more flat area goes down.
export function flattenMesh(positions: ArrayLike<number>, indices: ArrayLike<number>, down?: V3 | null): FlatGeom | null {
  const nv = Math.floor(positions.length / 3);
  if (nv < 3 || indices.length < 3) return null;
  const P: V3[] = Array.from({ length: nv }, (_, i) => [positions[i * 3] * 1000, positions[i * 3 + 1] * 1000, positions[i * 3 + 2] * 1000]);

  // Triangles' normals and areas, then the direction with the most planar area: the plate's normal.
  const tris: { a: number; b: number; c: number; n: V3; area: number }[] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    if (a >= nv || b >= nv || c >= nv) continue;
    const ab: V3 = [P[b][0] - P[a][0], P[b][1] - P[a][1], P[b][2] - P[a][2]];
    const ac: V3 = [P[c][0] - P[a][0], P[c][1] - P[a][1], P[c][2] - P[a][2]];
    const n = cross(ab, ac);
    const area = Math.hypot(n[0], n[1], n[2]) / 2;
    if (area > 1e-9) tris.push({ a, b, c, n: norm(n), area });
  }
  if (!tris.length) return null;
  const clusters: { dir: V3; area: number }[] = [];
  for (const t of [...tris].sort((x, y) => y.area - x.area)) {
    const hit = clusters.find((c) => Math.abs(dot(c.dir, t.n)) > 0.999);
    if (hit) hit.area += t.area;
    else if (clusters.length < MAX_CLUSTERS) clusters.push({ dir: t.n, area: t.area });
  }
  let N = down ? norm(neg(down)) : clusters.reduce((best, c) => (c.area > best.area ? c : best)).dir;

  // Top and bottom planes along N; the side with more flat area is the back (pockets cut into the
  // other side leave less of it at full height), and N points away from it.
  const span = (n: V3) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of P) {
      const d = dot(p, n);
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    return [lo, hi] as const;
  };
  let [lo, hi] = span(N);
  const onPlane = (t: (typeof tris)[number], level: number, n: V3) =>
    Math.abs(dot(t.n, n)) > 0.999 && [t.a, t.b, t.c].every((i) => Math.abs(dot(P[i], n) - level) < PLANE_TOL);
  let bottomArea = 0;
  let topArea = 0;
  for (const t of tris) {
    if (onPlane(t, lo, N)) bottomArea += t.area;
    else if (onPlane(t, hi, N)) topArea += t.area;
  }
  if (!down && topArea > bottomArea * 1.001) {
    N = neg(N);
    [lo, hi] = [-hi, -lo];
  }
  const thickness = hi - lo;

  // Any in-plane basis, the outline's convex hull, then its minimum-area rectangle: U along its
  // longer side.
  const seed: V3 = Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = norm(cross(N, seed));
  const e2 = cross(N, e1);
  const flat2 = P.map((p): Pt => [dot(p, e1), dot(p, e2)]);
  const hull = convexHull(flat2);
  const rect = minAreaRect(hull);
  const [c, s] = [Math.cos(rect.angle), Math.sin(rect.angle)];
  let U = norm([e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s]);
  if (rect.h > rect.w) U = cross(N, U); // turn 90° so U runs along the longer side
  const V = cross(N, U);

  let [xmin, xmax, ymin, ymax] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const p of P) {
    const x = dot(p, U);
    const y = dot(p, V);
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
    if (y < ymin) ymin = y;
    if (y > ymax) ymax = y;
  }
  const flatten: Mat4 = [U[0], U[1], U[2], -xmin, V[0], V[1], V[2], -ymin, N[0], N[1], N[2], -lo, 0, 0, 0, 1];
  const to2 = (p: V3): Pt => [dot(p, U) - xmin, dot(p, V) - ymin];

  // The back face's loops: triangle edges used once on the bottom plane.
  const loops = boundaryLoops(
    tris.filter((t) => onPlane(t, lo, N)).map((t) => [t.a, t.b, t.c]),
    (i) => to2(P[i]),
  );
  let outline: Pt[] = [];
  let holes: Pt[][] = [];
  if (loops.length) {
    const byArea = loops.map((l) => ({ l, a: Math.abs(polygonArea(l)) })).sort((x, y) => y.a - x.a);
    outline = byArea[0].l;
    holes = byArea.slice(1).map((x) => x.l);
  }
  // No clean back face (a bent or odd part): the convex silhouette.
  if (outline.length < 3) outline = convexHull(P.map(to2));
  if (polygonArea(outline) < 0) outline = [...outline].reverse();

  const w = xmax - xmin;
  const h = ymax - ymin;
  return { w, h, thickness, outline: simplify(outline), holes: holes.map(simplify), flatten, plate: thickness <= Math.min(w, h) * 0.35, down: neg(N) };
}

function boundaryLoops(tris: number[][], at: (i: number) => Pt): Pt[][] {
  // Vertices are shared within a face only; key them by position so faces stitch.
  const keyOf = new Map<number, string>();
  const ptOf = new Map<string, Pt>();
  const k = (i: number) => {
    let key = keyOf.get(i);
    if (!key) {
      const p = at(i);
      key = `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
      keyOf.set(i, key);
      if (!ptOf.has(key)) ptOf.set(key, p);
    }
    return key;
  };
  const count = new Map<string, number>();
  const edges: [string, string][] = [];
  for (const [a, b, c] of tris) {
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const [kp, kq] = [k(p), k(q)];
      if (kp === kq) continue;
      const id = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      count.set(id, (count.get(id) ?? 0) + 1);
      edges.push([kp, kq]);
    }
  }
  const next = new Map<string, string[]>();
  for (const [p, q] of edges) {
    const id = p < q ? `${p}|${q}` : `${q}|${p}`;
    if (count.get(id) !== 1) continue;
    next.set(p, [...(next.get(p) ?? []), q]);
    next.set(q, [...(next.get(q) ?? []), p]);
  }
  const loops: Pt[][] = [];
  const used = new Set<string>();
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop: string[] = [start];
    used.add(start);
    let prev = "";
    let cur = start;
    for (let guard = 0; guard < 200_000; guard++) {
      const options = (next.get(cur) ?? []).filter((n) => n !== prev && (!used.has(n) || (n === start && loop.length > 2)));
      const step = options[0];
      if (!step || step === start) break;
      used.add(step);
      loop.push(step);
      prev = cur;
      cur = step;
    }
    if (loop.length > 2) loops.push(loop.map((key) => ptOf.get(key)!));
  }
  return loops;
}

// Drops points on a straight run (tessellated arcs keep their points).
function simplify(loop: Pt[]): Pt[] {
  if (loop.length < 4) return loop;
  const out: Pt[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[(i - 1 + loop.length) % loop.length];
    const b = loop[i];
    const c = loop[(i + 1) % loop.length];
    const crossZ = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(crossZ) > 1e-4 * Math.max(1, Math.hypot(c[0] - a[0], c[1] - a[1]))) out.push([round2(b[0]), round2(b[1])]);
  }
  return out.length >= 3 ? out : loop;
}
const round2 = (n: number) => Math.round(n * 100) / 100;

export function polygonArea(loop: Pt[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const [x1, y1] = loop[i];
    const [x2, y2] = loop[(i + 1) % loop.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function convexHull(points: Pt[]): Pt[] {
  const pts = [...new Map(points.map((p) => [`${p[0].toFixed(3)},${p[1].toFixed(3)}`, p])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const turn = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// The smallest rectangle around a convex hull: one of its sides lies along a hull edge. `angle` is
// the direction of the rectangle's `w` side.
function minAreaRect(hull: Pt[]): { angle: number; w: number; h: number } {
  let best = { angle: 0, w: 0, h: 0, area: Infinity };
  for (let i = 0; i < hull.length; i++) {
    const [a, b] = [hull[i], hull[(i + 1) % hull.length]];
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of hull) {
      const x = p[0] * c + p[1] * s;
      const y = -p[0] * s + p[1] * c;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    const area = (x1 - x0) * (y1 - y0);
    if (area < best.area - 1e-6) best = { angle, w: x1 - x0, h: y1 - y0, area };
  }
  return best.area === Infinity ? { angle: 0, w: 0, h: 0 } : best;
}

// ---------- placing copies ----------

// Turns are in degrees about Z, any angle (the nester uses 0 and 90; ←/→ in the window step 5°).
const trig = (deg: number): [number, number] => {
  const t = (deg * Math.PI) / 180;
  const snap = (n: number) => (Math.abs(n - Math.round(n)) < 1e-12 ? Math.round(n) : n);
  return [snap(Math.cos(t)), snap(Math.sin(t))];
};
const turn = ([x, y]: Pt, deg: number): Pt => {
  const [c, s] = trig(deg);
  return [x * c - y * s, x * s + y * c];
};

// The turned bounding box's corners relative to the flat-frame origin.
function turnedBox(part: { w: number; h: number }, r: Rotation): { min: Pt; max: Pt } {
  const pts = ([[0, 0], [part.w, 0], [part.w, part.h], [0, part.h]] as Pt[]).map((p) => turn(p, r));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

// A copy's footprint on the sheet: its turned bounding box.
export function footprint(part: { w: number; h: number }, r: Rotation): Pt {
  const { min, max } = turnedBox(part, r);
  return [max[0] - min[0], max[1] - min[1]];
}

// Where the flat-frame origin goes so the turned bounding box starts at `corner`, and back.
export function originFromCorner(part: { w: number; h: number }, r: Rotation, corner: Pt): Pt {
  const { min } = turnedBox(part, r);
  return [corner[0] - min[0], corner[1] - min[1]];
}
export function cornerOf(part: { w: number; h: number }, p: { x: number; y: number; rotation: Rotation }): Pt {
  const { min } = turnedBox(part, p.rotation);
  return [p.x + min[0], p.y + min[1]];
}

// A flat-frame point on the sheet.
export function placePoint(pt: Pt, p: { x: number; y: number; rotation: Rotation }): Pt {
  const [rx, ry] = turn(pt, p.rotation);
  return [rx + p.x, ry + p.y];
}

// Every placed copy's cut loops on the sheet (outline and holes, mm), for the batch's layout DXF.
export function sheetLoops(parts: Map<string, Pick<FlatGeom, "outline" | "holes">>, placements: Placement[]): Pt[][] {
  return placements.flatMap((pl) => {
    const part = parts.get(pl.partId);
    return part ? [part.outline, ...part.holes].filter((l) => l.length > 2).map((l) => l.map((pt) => placePoint(pt, pl))) : [];
  });
}

const mul = (a: Mat4, b: Mat4): Mat4 => {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) out[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return out;
};

// T(x, y, 0) · Rz(rotation) · flatten: the copy's pose from its Part Studio, mm, row-major.
export function placementMatrix(part: { flatten: Mat4 }, p: { x: number; y: number; rotation: Rotation }): Mat4 {
  const [c, s] = trig(p.rotation);
  const placed: Mat4 = [c, -s, 0, p.x, s, c, 0, p.y, 0, 0, 1, 0, 0, 0, 0, 1];
  return mul(placed, part.flatten);
}

// ---------- nesting ----------

type Rect = { x: number; y: number; w: number; h: number };
type Item = { partId: string; copy: number; w: number; h: number };

// One sheet's MaxRects packing, bottom-left: each copy goes where its top edge sits lowest, then
// leftmost. Sizes already include the gap.
function maxRects(items: Item[], W: number, H: number, rotate: boolean) {
  let free: Rect[] = [{ x: 0, y: 0, w: W, h: H }];
  const placed: { item: Item; x: number; y: number; turned: boolean }[] = [];
  const left: Item[] = [];
  for (const item of items) {
    let best: { x: number; y: number; turned: boolean; score: number; tie: number } | null = null;
    for (const f of free) {
      for (const t of rotate && item.w !== item.h ? [false, true] : [false]) {
        const [w, h] = t ? [item.h, item.w] : [item.w, item.h];
        if (w > f.w + 1e-6 || h > f.h + 1e-6) continue;
        const score = f.y + h;
        if (!best || score < best.score - 1e-6 || (Math.abs(score - best.score) < 1e-6 && f.x < best.tie)) best = { x: f.x, y: f.y, turned: t, score, tie: f.x };
      }
    }
    if (!best) {
      left.push(item);
      continue;
    }
    const [w, h] = best.turned ? [item.h, item.w] : [item.w, item.h];
    const used = { x: best.x, y: best.y, w, h };
    placed.push({ item, x: best.x, y: best.y, turned: best.turned });
    const next: Rect[] = [];
    for (const f of free) {
      if (used.x >= f.x + f.w || used.x + used.w <= f.x || used.y >= f.y + f.h || used.y + used.h <= f.y) {
        next.push(f);
        continue;
      }
      if (used.x > f.x) next.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h });
      if (used.x + used.w < f.x + f.w) next.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - used.x - used.w, h: f.h });
      if (used.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y });
      if (used.y + used.h < f.y + f.h) next.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - used.y - used.h });
    }
    free = next.filter(
      (a, i) => a.w > 1e-6 && a.h > 1e-6 && !next.some((b, j) => j !== i && b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h && (j < i || b.w * b.h > a.w * a.h)),
    );
  }
  return { placed, left };
}

const ORDERS: ((a: Item, b: Item) => number)[] = [
  (a, b) => b.w * b.h - a.w * a.h,
  (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h),
  (a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h),
  (a, b) => b.w + b.h - (a.w + a.h),
];

// Every copy of every part on one sheet of `sheetW` × `sheetH` (no height: as short as it gets).
// Tries a few orders and keeps the one that places most, then the smallest box.
export function nestParts(parts: FlatPart[], opts: NestOptions): Nest {
  const gap = opts.gap ?? DEFAULT_GAP;
  const margin = opts.margin ?? DEFAULT_MARGIN;
  const items: Item[] = parts.flatMap((p) => Array.from({ length: Math.max(0, p.quantity) }, (_, copy) => ({ partId: p.partId, copy, w: p.w + gap, h: p.h + gap })));
  const W = opts.sheetW - 2 * margin + gap;
  const H = opts.sheetH ? opts.sheetH - 2 * margin + gap : items.reduce((t, i) => t + Math.max(i.w, i.h), 0) + 1;
  const byId = new Map(parts.map((p) => [p.partId, p]));
  let best: Nest | null = null;
  let bestScore: [number, number] = [Infinity, Infinity];
  for (const order of ORDERS) {
    const { placed, left } = maxRects([...items].sort(order), W, H, true);
    let width = 0;
    let height = 0;
    const placements = placed.map(({ item, x, y, turned }) => {
      const part = byId.get(item.partId)!;
      const rotation: Rotation = turned ? 90 : 0;
      const [fw, fh] = footprint(part, rotation);
      width = Math.max(width, x + fw);
      height = Math.max(height, y + fh);
      const [ox, oy] = originFromCorner(part, rotation, [x + margin, y + margin]);
      return { partId: item.partId, copy: item.copy, x: ox, y: oy, rotation };
    });
    const score: [number, number] = [left.length, width * height];
    if (score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
      bestScore = score;
      best = { placements, width, height, unplaced: left.map((i) => ({ partId: i.partId, copy: i.copy })) };
    }
  }
  return best ?? { placements: [], width: 0, height: 0, unplaced: [] };
}

// The nested parts' bounding box from their placements (after dragging), without the margin.
export function layoutBox(parts: FlatPart[], placements: Placement[]): { x0: number; y0: number; x1: number; y1: number } {
  const byId = new Map(parts.map((p) => [p.partId, p]));
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const pl of placements) {
    const part = byId.get(pl.partId);
    if (!part) continue;
    const [cx, cy] = cornerOf(part, pl);
    const [fw, fh] = footprint(part, pl.rotation);
    x0 = Math.min(x0, cx);
    y0 = Math.min(y0, cy);
    x1 = Math.max(x1, cx + fw);
    y1 = Math.max(y1, cy + fh);
  }
  return x0 === Infinity ? { x0: 0, y0: 0, x1: 0, y1: 0 } : { x0, y0, x1, y1 };
}

// ---------- the stock plate advisor ----------

export type StockPiece = { size: string; label: string; share: string; x: number; y: number; count: number };
export type PlateAdvice = {
  piece: StockPiece | null; // the smallest piece on the shelf that takes every copy
  sheetW: number;
  sheetH: number; // the sheet the layout was nested on (the piece, turned to fit best)
  pieces: (StockPiece & { fits: boolean })[]; // everything on the shelf, smallest first
  sheetsNeeded: number; // when no single piece fits: how many of the biggest piece it takes
};

// The smallest piece in stock that fits every copy, tried both ways round.
export function advisePlate(parts: FlatPart[], pieces: StockPiece[], gap = DEFAULT_GAP, margin = DEFAULT_MARGIN): { advice: PlateAdvice; nest: Nest } {
  const inStock = pieces.filter((p) => p.count > 0 && p.x > 0 && p.y > 0).sort((a, b) => a.x * a.y - b.x * b.y);
  const tried = inStock.map((piece) => {
    const options = [
      { w: Math.max(piece.x, piece.y), h: Math.min(piece.x, piece.y) },
      { w: Math.min(piece.x, piece.y), h: Math.max(piece.x, piece.y) },
    ].map((s) => ({ ...s, nest: nestParts(parts, { sheetW: s.w, sheetH: s.h, gap, margin }) }));
    const ok = options.find((o) => !o.nest.unplaced.length);
    return { piece, fits: !!ok, ok };
  });
  const pick = tried.find((t) => t.fits);
  if (pick?.ok) {
    return {
      advice: { piece: pick.piece, sheetW: pick.ok.w, sheetH: pick.ok.h, pieces: tried.map((t) => ({ ...t.piece, fits: t.fits })), sheetsNeeded: 1 },
      nest: pick.ok.nest,
    };
  }
  // Nothing on the shelf takes it all: lay it out on the biggest piece's width (or the default
  // sheet), and count how many of the biggest piece it would take.
  const biggest = inStock.at(-1);
  const sheetW = biggest ? Math.max(biggest.x, biggest.y) : DEFAULT_SHEET_W;
  const nest = nestParts(parts, { sheetW, gap, margin });
  let sheetsNeeded = 0;
  if (biggest) {
    let rest = parts.map((p) => ({ ...p }));
    for (let n = 0; n < 50 && rest.some((p) => p.quantity > 0); n++) {
      const sheet = nestParts(rest, { sheetW: Math.max(biggest.x, biggest.y), sheetH: Math.min(biggest.x, biggest.y), gap, margin });
      if (!sheet.placements.length) {
        sheetsNeeded = 0; // a part bigger than the piece
        break;
      }
      sheetsNeeded++;
      const leftOver = new Map<string, number>();
      sheet.unplaced.forEach((u) => leftOver.set(u.partId, (leftOver.get(u.partId) ?? 0) + 1));
      rest = rest.map((p) => ({ ...p, quantity: leftOver.get(p.partId) ?? 0 }));
    }
  }
  return {
    advice: { piece: null, sheetW, sheetH: biggest ? Math.min(biggest.x, biggest.y) : 0, pieces: tried.map((t) => ({ ...t.piece, fits: t.fits })), sheetsNeeded },
    nest,
  };
}
