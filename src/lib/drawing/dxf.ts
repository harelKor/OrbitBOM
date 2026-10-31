// A 1:1 millimetre ASCII DXF (R12: LINE, ARC and CIRCLE only, which every laser program reads)
// of a flat plate's cut loops. The mesh's loops are polygons whose corners lie on the true
// curves, so holes are written back as circles and runs of corners on one circle as arcs.

import type { P2 } from "./flatten";

export type DxfEntity =
  | { type: "line"; a: P2; b: P2 }
  | { type: "circle"; c: P2; r: number }
  | { type: "arc"; c: P2; r: number; start: number; end: number }; // degrees, counter-clockwise

const TOL = 0.01; // mm a corner may sit off the fitted circle
const MAX_R = 5000; // mm: flatter than this is a straight line
const MAX_STEP = (30 * Math.PI) / 180; // a curve's tessellation (Onshape's 0.35 rad angle tolerance) turns less than this per side

function circleThrough(a: P2, b: P2, c: P2): { c: P2; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  const x = (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d;
  const y = (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d;
  return { c: [x, y], r: Math.hypot(a[0] - x, a[1] - y) };
}

const turn = (a: P2, b: P2, c: P2) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
const angleOf = (c: P2, p: P2) => (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI;
const norm360 = (d: number) => ((d % 360) + 360) % 360;

// Corners i..j (indices into pts, j may run past the end) on one circle, turning one way?
function arcFit(pts: P2[], i: number, j: number) {
  const at = (k: number) => pts[k % pts.length];
  const fit = circleThrough(at(i), at(Math.round((i + j) / 2)), at(j));
  if (!fit || fit.r > MAX_R) return null;
  const sign = Math.sign(turn(at(i), at(i + 1), at(i + 2)));
  if (!sign) return null;
  let sweep = 0;
  for (let k = i; k < j; k++) {
    if (Math.abs(Math.hypot(at(k)[0] - fit.c[0], at(k)[1] - fit.c[1]) - fit.r) > TOL) return null;
    if (k + 2 <= j && Math.sign(turn(at(k), at(k + 1), at(k + 2))) !== sign) return null;
    const step = 2 * Math.asin(Math.min(1, Math.hypot(at(k + 1)[0] - at(k)[0], at(k + 1)[1] - at(k)[1]) / (2 * fit.r)));
    if (step > MAX_STEP) return null;
    sweep += step;
  }
  if (Math.abs(Math.hypot(at(j)[0] - fit.c[0], at(j)[1] - fit.c[1]) - fit.r) > TOL) return null;
  if (sweep >= 2 * Math.PI - 1e-6) return null;
  return { ...fit, ccw: sign > 0 };
}

// One closed loop as entities: a circle, or lines and arcs.
export function loopEntities(input: P2[]): DxfEntity[] {
  const pts: P2[] = [];
  for (const p of input) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-4) pts.push(p);
  }
  while (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) <= 1e-4) pts.pop();
  const n = pts.length;
  if (n < 2) return [];
  if (n === 2) return [{ type: "line", a: pts[0], b: pts[1] }];

  // A whole circle (a round hole or a disc).
  if (n >= 6) {
    const fit = circleThrough(pts[0], pts[Math.floor(n / 3)], pts[Math.floor((2 * n) / 3)]);
    const onIt = (p: P2) => !!fit && Math.abs(Math.hypot(p[0] - fit.c[0], p[1] - fit.c[1]) - fit.r) <= TOL;
    const short = (p: P2, k: number) => !!fit && Math.hypot(pts[(k + 1) % n][0] - p[0], pts[(k + 1) % n][1] - p[1]) <= 2 * fit.r * Math.sin(MAX_STEP / 2) + 1e-6;
    if (fit && fit.r < MAX_R && pts.every((p, k) => onIt(p) && short(p, k))) {
      return [{ type: "circle", c: fit.c, r: fit.r }];
    }
  }

  // Start at the corner after the longest side, so a run seldom wraps past the start.
  let start = 0;
  let longest = -1;
  for (let k = 0; k < n; k++) {
    const len = Math.hypot(pts[(k + 1) % n][0] - pts[k][0], pts[(k + 1) % n][1] - pts[k][1]);
    if (len > longest) [longest, start] = [len, k];
  }
  // Back to where that side's straight run begins.
  for (let k = 0; k < n; k++) {
    const [a, b, c] = [pts[(start - 1 + n) % n], pts[start], pts[(start + 1) % n]];
    if (Math.abs(turn(a, b, c)) / (Math.hypot(c[0] - a[0], c[1] - a[1]) || 1) > 1e-3) break;
    start = (start - 1 + n) % n;
  }
  const ring = [...pts.slice(start), ...pts.slice(0, start)];
  const at = (k: number) => ring[k % n];
  const out: DxfEntity[] = [];
  let i = 0;
  while (i < n) {
    // The longest run of 3+ sides on one circle from corner i.
    let best: { j: number; c: P2; r: number; ccw: boolean } | null = null;
    for (let j = i + 3; j <= n; j++) {
      const fit = arcFit(ring, i, j);
      if (fit) best = { j, ...fit };
      else if (best) break;
    }
    if (best) {
      const [a, b] = [angleOf(best.c, at(i)), angleOf(best.c, at(best.j))];
      out.push({ type: "arc", c: best.c, r: best.r, ...(best.ccw ? { start: norm360(a), end: norm360(b) } : { start: norm360(b), end: norm360(a) }) });
      i = best.j;
      continue;
    }
    // A straight side, joined with the next ones while they run on in line.
    let j = i + 1;
    while (j < n) {
      const [a, b, c] = [at(i), at(j), at(j + 1)];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      if (Math.abs(turn(a, b, c)) / len > 1e-3 || arcStartsAt(ring, j)) break;
      j++;
    }
    out.push({ type: "line", a: at(i), b: at(j) });
    i = j;
  }
  return out;
}

const arcStartsAt = (ring: P2[], k: number) => k + 3 <= ring.length && !!arcFit(ring, k, k + 3);

const num = (x: number) => {
  const s = x.toFixed(4).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
};

export function writeDxf(loops: P2[][], opts: { layer?: string } = {}): string {
  const layer = opts.layer ?? "CUT";
  const entities = loops.flatMap(loopEntities);
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const l of loops)
    for (const [x, y] of l) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  if (!Number.isFinite(x0)) [x0, y0, x1, y1] = [0, 0, 0, 0];
  const out: (string | number)[] = [];
  const g = (code: number, value: string | number) => out.push(code, typeof value === "number" ? num(value) : value);
  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$ACADVER");
  g(1, "AC1009");
  g(9, "$INSUNITS");
  g(70, "4"); // millimetres
  g(9, "$MEASUREMENT");
  g(70, "1"); // metric
  g(9, "$EXTMIN");
  g(10, x0);
  g(20, y0);
  g(9, "$EXTMAX");
  g(10, x1);
  g(20, y1);
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "TABLES");
  g(0, "TABLE");
  g(2, "LAYER");
  g(70, "1");
  g(0, "LAYER");
  g(2, layer);
  g(70, "0");
  g(62, "7");
  g(6, "CONTINUOUS");
  g(0, "ENDTAB");
  g(0, "ENDSEC");
  g(0, "SECTION");
  g(2, "ENTITIES");
  for (const e of entities) {
    if (e.type === "line") {
      g(0, "LINE");
      g(8, layer);
      g(10, e.a[0]);
      g(20, e.a[1]);
      g(30, 0);
      g(11, e.b[0]);
      g(21, e.b[1]);
      g(31, 0);
    } else {
      g(0, e.type === "circle" ? "CIRCLE" : "ARC");
      g(8, layer);
      g(10, e.c[0]);
      g(20, e.c[1]);
      g(30, 0);
      g(40, e.r);
      if (e.type === "arc") {
        g(50, e.start);
        g(51, e.end);
      }
    }
  }
  g(0, "ENDSEC");
  g(0, "EOF");
  return out.join("\r\n") + "\r\n";
}
