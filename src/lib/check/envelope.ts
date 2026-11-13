import type { EnvelopeResult } from "./types";

// The robot seen from above: the frame perimeter is the outline a string pulled round the frame
// would make (the convex hull of the parts in plan view), as the rules measure it. Points are
// flat [x0, y0, x1, y1, …] arrays in mm.

// The convex hull, counter-clockwise, without points in line (Andrew's monotone chain).
export function hull(pts: ArrayLike<number>): number[] {
  const n = Math.floor(pts.length / 2);
  if (n < 3) return Array.from(pts);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => pts[2 * a] - pts[2 * b] || pts[2 * a + 1] - pts[2 * b + 1]);
  const cross = (o: number, a: number, b: number) => (pts[2 * a] - pts[2 * o]) * (pts[2 * b + 1] - pts[2 * o + 1]) - (pts[2 * a + 1] - pts[2 * o + 1]) * (pts[2 * b] - pts[2 * o]);
  const lower: number[] = [];
  for (const i of order) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }
  const ids = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  return ids.flatMap((i) => [pts[2 * i], pts[2 * i + 1]]);
}

export function perimeter(h: number[]): number {
  const n = h.length / 2;
  let p = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    p += Math.hypot(h[2 * j] - h[2 * i], h[2 * j + 1] - h[2 * i + 1]);
  }
  return p;
}

// The smallest rectangle round a convex hull: one of its sides lies along a hull edge.
export function minRect(h: number[]): { length: number; width: number } {
  const n = h.length / 2;
  let best = { area: Infinity, length: 0, width: 0 };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = h[2 * j] - h[2 * i];
    const dy = h[2 * j + 1] - h[2 * i + 1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len, uy = dy / len;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const a = h[2 * k] * ux + h[2 * k + 1] * uy;
      const b = -h[2 * k] * uy + h[2 * k + 1] * ux;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a);
      b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (area < best.area) best = { area, length: Math.max(a1 - a0, b1 - b0), width: Math.min(a1 - a0, b1 - b0) };
  }
  return { length: best.length, width: best.width };
}

// How far a point is outside a counter-clockwise convex polygon (the furthest edge line it is
// past; ≤ 0 inside). Enough to say "sticks out about 40 mm".
export function outside(h: number[], x: number, y: number): number {
  const n = h.length / 2;
  let d = -Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = h[2 * j] - h[2 * i];
    const ey = h[2 * j + 1] - h[2 * i + 1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    // Right of an edge of a counter-clockwise polygon is outside.
    d = Math.max(d, ((x - h[2 * i]) * ey - (y - h[2 * i + 1]) * ex) / len);
  }
  return d;
}

// Each placed part's own hulls in plan view: all of it (`outline`) and the bit within the frame
// zone (`frame`, empty when none of it is that low).
export type PlanPart = { key: string; name: string; outline: number[]; frame: number[] };

// Parts poking out less than this are the hull's own rounding, not worth a line.
const OUT_MIN_MM = 3;

export function buildEnvelope(parts: PlanPart[], heightMm: number): EnvelopeResult | null {
  const outline = hull(parts.flatMap((p) => p.outline));
  const framePts = parts.flatMap((p) => p.frame);
  const frame = framePts.length >= 6 ? hull(framePts) : outline;
  if (frame.length < 6) return null;
  const rect = minRect(frame);
  const out = new Map<string, { key: string; name: string; mm: number }>();
  for (const p of parts) {
    let mm = -Infinity;
    for (let i = 0; i + 1 < p.outline.length; i += 2) mm = Math.max(mm, outside(frame, p.outline[i], p.outline[i + 1]));
    if (mm < OUT_MIN_MM) continue;
    const was = out.get(p.key);
    if (!was || was.mm < mm) out.set(p.key, { key: p.key, name: p.name, mm: Math.round(mm) });
  }
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    perimeterMm: r(perimeter(frame)),
    outlineMm: r(perimeter(outline)),
    lengthMm: r(rect.length),
    widthMm: r(rect.width),
    heightMm: r(heightMm),
    hull: Array.from({ length: frame.length / 2 }, (_, i) => [r(frame[2 * i]), r(frame[2 * i + 1])] as [number, number]),
    out: [...out.values()].sort((a, b) => b.mm - a.mm),
  };
}
