// What stock a part is cut from, read from its 3D model's mesh (the R2 .obm file, no Onshape
// calls): hex shaft, box tube, round tube, round rod, turned spacer, plate (with or without
// pockets), or a solid block. Suggest setup (rules.ts) turns the shape and Onshape's material into
// a Raw Stock inventory item and processes.
//
// Everything is measured in the part's own frame, not the Part Studio's axes, so a plate or
// shaft that sits at an angle measures the same as one on the axes.

export type ShapeKind = "hex" | "box-tube" | "round-tube" | "rod" | "spacer" | "plate" | "block";

export type Shape = {
  kind: ShapeKind;
  // Cross-section for hex / tubes / rods (smallest width, the width across it), mm. For a hex
  // shaft d1 is flat-to-flat and d2 corner-to-corner; for a round part both are the diameter.
  d1?: number;
  d2?: number;
  length?: number; // along the long axis, mm
  wall?: number; // tube wall, mm
  // A round part's bore when it isn't round (a hex bore for a 1/2" shaft), and its width across
  // the flats, mm: a stock tube's bore is round, so this part is printed or machined.
  bore?: "hex" | "polygon";
  boreFlats?: number;
  t?: number; // plate thickness, mm
  pocketed?: boolean; // a plate with floors between its top and bottom faces (pockets, steps)
  turned?: boolean; // a hex shaft with ends turned round
  thunder?: boolean; // a hex with rounded corners (ThunderHex)
  axisymmetric?: boolean; // round about some axis: a lathe can make it
  size?: [number, number, number]; // the part's own-frame box, mm, smallest first (blocks)
  // A round outer surface whose axis lies across its thinnest direction (a turned end, a rod's
  // side): never cut from plate (Harel, 2026-11-21: "plates can never have such circular shape").
  roundAlong?: boolean;
};

type V = [number, number, number];
type Tri = { n: V; area: number; c: V; v: [V, V, V] };

const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const r2 = (x: number) => Math.round(x * 100) / 100;

function triangles(positions: ArrayLike<number>, indices: ArrayLike<number>): Tri[] {
  const p = (i: number): V => [positions[3 * i] * 1000, positions[3 * i + 1] * 1000, positions[3 * i + 2] * 1000];
  const out: Tri[] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = p(indices[t]);
    const b = p(indices[t + 1]);
    const c = p(indices[t + 2]);
    const cr = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    const len = Math.hypot(cr[0], cr[1], cr[2]);
    if (len < 1e-12) continue;
    out.push({ n: [cr[0] / len, cr[1] / len, cr[2] / len], area: len / 2, c: [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], v: [a, b, c] });
  }
  return out;
}

// Enclosed volume (mm³) by the divergence theorem; Onshape meshes are closed.
function volume(tris: Tri[]) {
  let v = 0;
  for (const { v: [a, b, c] } of tris) v += dot(a, cross(b, c)) / 6;
  return Math.abs(v);
}

// Eigenvectors of a symmetric 3x3 matrix (Jacobi), sorted by eigenvalue, smallest first.
function eigen(m: number[][]): { values: number[]; vectors: V[] } {
  const a = m.map((r) => [...r]);
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += a[i][j] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i][i] - a[j][j]);
  return { values: order.map((i) => a[i][i]), vectors: order.map((i) => norm([v[0][i], v[1][i], v[2][i]])) };
}

// Two unit vectors across `axis`.
function basis(axis: V): [V, V] {
  const helper: V = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(axis, helper));
  return [u, cross(axis, u)];
}

// The outline across `axis`: the narrowest width and its direction, the width across that, the
// widest width, and the centre of the narrowest/across box.
function section(points: V[], axis: V) {
  const [e1, e2] = basis(axis);
  const xy = points.map((p) => [dot(p, e1), dot(p, e2)] as const);
  const width = (ang: number) => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [x, y] of xy) {
      const d = x * c + y * s;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    return { w: hi - lo, mid: (hi + lo) / 2 };
  };
  let best = { ang: 0, w: Infinity, mid: 0 };
  let widest = 0;
  for (let k = 0; k < 180; k++) {
    const ang = (k * Math.PI) / 180;
    const { w, mid } = width(ang);
    if (w < best.w) best = { ang, w, mid };
    if (w > widest) widest = w;
  }
  // Refine the narrowest direction to a tenth of a degree.
  for (let k = -10; k <= 10; k++) {
    const ang = best.ang + (k * Math.PI) / 1800;
    const { w, mid } = width(ang);
    if (w < best.w) best = { ang, w, mid };
  }
  const across = width(best.ang + Math.PI / 2);
  const dir = (ang: number): V => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return [e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s];
  };
  const u = dir(best.ang);
  const v = dir(best.ang + Math.PI / 2);
  const centre2 = [best.mid, across.mid];
  return { d1: best.w, d2: across.w, widest, u, v, centre2, e: [u, v] as [V, V] };
}

function extent(points: V[], dir: V) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    const d = dot(p, dir);
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return { lo, hi, len: hi - lo };
}

// Area-weighted median.
function median(xs: { x: number; w: number }[]) {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a.x - b.x);
  const total = s.reduce((t, a) => t + a.w, 0);
  let acc = 0;
  return s.find((a) => (acc += a.w) >= total / 2)!.x;
}

// Sets of triangles sharing one normal direction (either sense), largest first: a plate's faces
// are one of the first few (the long walls of a narrow pocketed frame can outweigh its faces).
function planeNormals(tris: Tri[]): V[] {
  const bins = new Map<string, { n: V; area: number }>();
  for (const t of tris) {
    let n = t.n;
    // One sense per direction.
    if (n[2] < -1e-6 || (Math.abs(n[2]) <= 1e-6 && (n[1] < -1e-6 || (Math.abs(n[1]) <= 1e-6 && n[0] < 0)))) n = [-n[0], -n[1], -n[2]];
    const key = n.map((x) => Math.round(x * 200)).join(",");
    const b = bins.get(key);
    if (b) b.area += t.area;
    else bins.set(key, { n, area: t.area });
  }
  return [...bins.values()].sort((a, b) => b.area - a.area).map((b) => b.n);
}

// Wall of a box tube: for each outer side, the nearest inner face parallel to it.
function boxWall(tris: Tri[], dirs: V[], total: number): number | undefined {
  const walls: { x: number; w: number }[] = [];
  for (const d of dirs) {
    const planes = new Map<number, number>(); // position (0.05 mm) → area
    for (const t of tris) {
      if (Math.abs(dot(t.n, d)) < 0.98) continue;
      const k = Math.round(dot(t.c, d) * 20);
      planes.set(k, (planes.get(k) ?? 0) + t.area);
    }
    const ps = [...planes].map(([k, a]) => ({ x: k / 20, a })).filter((p) => p.a > total * 0.01);
    if (ps.length < 2) continue;
    const lo = Math.min(...ps.map((p) => p.x));
    const hi = Math.max(...ps.map((p) => p.x));
    for (const [outer, sign] of [
      [lo, 1],
      [hi, -1],
    ] as const) {
      const inner = ps
        .map((p) => ({ ...p, off: (p.x - outer) * sign }))
        .filter((p) => p.off > 0.3 && p.off < Math.min(8, (hi - lo) / 2 - 0.1))
        .sort((a, b) => a.off - b.off)[0];
      if (inner) walls.push({ x: inner.off, w: inner.a });
    }
  }
  const m = median(walls);
  return m === undefined ? undefined : r2(m);
}

// How much of a plate face's area its floors (pockets, counterbores, steps) must cover.
const POCKET_SHARE = 0.005;

// How much of the side area (faces along `axis`) faces straight out from the axis or in to it, as
// on a part turned on a lathe. A gear or sprocket has a round outline too, but its tooth flanks
// face sideways, so it isn't turned (Harel, 2026-11-13: 42T and 28T gears were going to the LATHE).
function radialShare(tris: Tri[], axis: V, sec: { u: V; v: V; centre2: number[] }) {
  let side = 0;
  let radial = 0;
  for (const t of tris) {
    if (Math.abs(dot(t.n, axis)) > 0.3) continue;
    const x = dot(t.c, sec.u) - sec.centre2[0];
    const y = dot(t.c, sec.v) - sec.centre2[1];
    const r = Math.hypot(x, y);
    side += t.area;
    if (r < 1e-6) continue;
    const along = (dot(t.n, sec.u) * x + dot(t.n, sec.v) * y) / r;
    if (Math.abs(along) > 0.95) radial += t.area;
  }
  return side ? radial / side : 0;
}
// How much of the surface curves around an axis lying across `thin` (its normals sweep between
// facing along `thin` and facing across it). A plate's faces, edges and holes all face exactly
// along or across its thickness; a cylinder lying in it doesn't.
function curvedAcross(tris: Tri[], thin: V, total: number) {
  let curved = 0;
  for (const t of tris) {
    const a = Math.abs(dot(t.n, thin));
    if (a > 0.2 && a < 0.98) curved += t.area;
  }
  return curved / total;
}
const ROUND_ALONG_SHARE = 0.2;

// Turned parts measure 1.0 (cross holes bring it down a little); gears and pulleys 0.35–0.65.
const TURNED_SHARE = 0.8;

// Reads a part's stock shape from its mesh (positions in metres, as in the .obm file).
export function analyzeShape(positions: ArrayLike<number>, indices: ArrayLike<number>): Shape | undefined {
  const tris = triangles(positions, indices);
  if (tris.length < 4) return undefined;
  const total = tris.reduce((s, t) => s + t.area, 0);
  if (!total) return undefined;
  const points: V[] = [];
  const step = Math.max(1, Math.floor(positions.length / 3 / 20000));
  for (let i = 0; i < positions.length / 3; i += step) points.push([positions[3 * i] * 1000, positions[3 * i + 1] * 1000, positions[3 * i + 2] * 1000]);
  const vol = volume(tris);

  // The long axis: the direction the surface normals avoid (a prism's sides all face across it).
  const m = [0, 1, 2].map((i) => [0, 1, 2].map((j) => tris.reduce((s, t) => s + t.area * t.n[i] * t.n[j], 0)));
  const { vectors } = eigen(m);
  const L = vectors[0];
  const len = extent(points, L).len;
  const sec = section(points, L);
  const sideArea = tris.reduce((s, t) => s + (Math.abs(dot(t.n, L)) < 0.15 ? t.area : 0), 0);
  const prism = sideArea / total > 0.55 && len > sec.d2 * 1.2;
  const round = sec.d2 / sec.d1 < 1.08 && sec.widest / sec.d1 < 1.05 && radialShare(tris, L, sec) >= TURNED_SHARE;
  const radius = (p: V) => Math.hypot(dot(p, sec.u) - sec.centre2[0], dot(p, sec.v) - sec.centre2[1]);
  const base = { d1: r2(sec.d1), d2: r2(sec.d2), length: r2(len) };

  // Plates first: thin across their biggest flat faces and wide. A plate's two faces are parallel
  // to any line in its plane, so the prism test below took plates for box tubes or blocks (Harel,
  // 2026-11-13: pocketed 6.7 mm plates read as "box tube 6.7×136.8" and went to the laser). Pocket
  // and hole walls can outweigh the faces on a heavily pocketed plate, so the faces need only a
  // fifth of the area.
  const reading = (N: V) => {
    const ex = extent(points, N);
    const t = ex.len;
    const across = section(points, N);
    const parallel = tris.filter((tr) => Math.abs(dot(tr.n, N)) > 0.995);
    const planar = parallel.reduce((s, tr) => s + tr.area, 0);
    const discRound = across.d2 / across.d1 < 1.05 && across.widest / across.d1 < 1.05;
    // A round part thick for its size (spacer, bushing, pulley) is turned; a thin disc is a plate.
    const spacer = discRound && t >= across.d1 / 6 && radialShare(tris, N, across) >= TURNED_SHARE;
    const plate = t >= 0.5 && t <= 13 && across.d1 > 2.2 * t && planar / total > 0.2 && curvedAcross(tris, N, total) < ROUND_ALONG_SHARE;
    const floors = parallel.reduce((s, tr) => {
      const z = dot(tr.c, N) - ex.lo;
      return s + (z > 0.2 && z < t - 0.2 ? tr.area : 0);
    }, 0);
    return { t, across, spacer, plate, floors, planar };
  };
  const readings = planeNormals(tris).slice(0, 3).map(reading);
  const flat = readings.find((r) => r.plate);
  const spacer = readings.find((r) => r.spacer);
  if (flat && !spacer) {
    // Any floor counts: a counterbore or a step along an edge is cut on the CNC like a pocket
    // (Harel, 2026-11-06: stepped 3 mm plates read as plain).
    const { t, across } = flat;
    return { kind: "plate", t: r2(t), d1: r2(across.d1), d2: r2(across.d2), pocketed: flat.floors > (flat.planar / 2) * POCKET_SHARE };
  }

  if (prism) {
    // Hex: 1/2" (12.7 mm flats) or 3/8" (9.525 mm), corner-to-corner 1.155x flats (ThunderHex's
    // rounded corners less).
    const ratio = sec.d2 / sec.d1;
    const hexFlats = (sec.d1 >= 12.4 && sec.d1 <= 13.0) || (sec.d1 >= 9.3 && sec.d1 <= 9.8);
    if (hexFlats && ratio >= 1.04 && ratio <= 1.2 && sec.widest / sec.d1 <= 1.2) {
      // Turned ends: round side faces inside the hex's flats.
      const inside = tris.reduce((s, t) => s + (Math.abs(dot(t.n, L)) < 0.15 && t.v.every((p) => radius(p) < sec.d1 / 2 - 0.25) ? t.area : 0), 0);
      return { kind: "hex", ...base, thunder: ratio < 1.12, turned: inside > sideArea * 0.03 };
    }
    // Box tube: a rectangle outline (widest = its diagonal), hollow.
    const fillBox = vol / (sec.d1 * sec.d2 * len);
    const rect = Math.abs(sec.widest - Math.hypot(sec.d1, sec.d2)) <= Math.hypot(sec.d1, sec.d2) * 0.06;
    if (rect && fillBox >= 0.08 && fillBox <= 0.5) {
      return { kind: "box-tube", ...base, wall: boxWall(tris, [sec.u, sec.v], total) };
    }
    if (round) {
      const od = (sec.d1 + sec.d2) / 2;
      const fill = vol / ((Math.PI / 4) * od * od * len);
      if (fill >= 0.08 && fill <= 0.6) {
        // The bore: side faces that face the axis.
        const inner: { x: number; w: number }[] = [];
        // The bore faces' distance from the axis over the bore's farthest corner: ~1 on a round
        // bore (its facets are narrow), cos 30° = 0.87 on a hex bore's flats.
        const apothem: { x: number; w: number }[] = [];
        let farthest = 0;
        for (const t of tris) {
          if (Math.abs(dot(t.n, L)) > 0.15) continue;
          const rc = radius(t.c);
          const out: V = [
            sec.u[0] * (dot(t.c, sec.u) - sec.centre2[0]) + sec.v[0] * (dot(t.c, sec.v) - sec.centre2[1]),
            sec.u[1] * (dot(t.c, sec.u) - sec.centre2[0]) + sec.v[1] * (dot(t.c, sec.v) - sec.centre2[1]),
            sec.u[2] * (dot(t.c, sec.u) - sec.centre2[0]) + sec.v[2] * (dot(t.c, sec.v) - sec.centre2[1]),
          ];
          if (rc > od * 0.15 && dot(t.n, out) < -0.8 * rc) {
            const corner = Math.max(...t.v.map(radius));
            inner.push({ x: corner, w: t.area });
            apothem.push({ x: -dot(t.n, out), w: t.area });
            farthest = Math.max(farthest, corner);
          }
        }
        const ri = median(inner);
        const wall = ri !== undefined ? od / 2 - ri : undefined;
        const a = median(apothem);
        const f = a !== undefined && farthest ? a / farthest : undefined;
        const bore = f !== undefined && a !== undefined && f < 0.96 ? { bore: f >= 0.83 && f <= 0.9 ? ("hex" as const) : ("polygon" as const), boreFlats: r2(2 * a) } : {};
        return { kind: "round-tube", ...base, ...(wall !== undefined && wall > 0.2 && { wall: r2(wall) }), ...bore };
      }
      if (fill > 0.6) return { kind: "rod", ...base, axisymmetric: true };
    }
  }

  // Turned spacers: measured across their biggest flat faces.
  if (spacer) return { kind: "spacer", d1: r2(spacer.t), d2: r2(spacer.across.d1), length: r2(spacer.t), axisymmetric: true };
  if (flat) {
    const { t, across } = flat;
    return { kind: "plate", t: r2(t), d1: r2(across.d1), d2: r2(across.d2), pocketed: flat.floors > (flat.planar / 2) * POCKET_SHARE };
  }

  const size = [sec.d1, sec.d2, len].map(r2).sort((a, b) => a - b) as [number, number, number];
  const thin = [sec.u, sec.v, L].map((d) => ({ d, len: extent(points, d).len })).sort((a, b) => a.len - b.len)[0].d;
  const roundAlong = curvedAcross(tris, thin, total) >= ROUND_ALONG_SHARE;
  return { kind: "block", ...base, size, axisymmetric: round, ...(roundAlong && { roundAlong }) };
}
