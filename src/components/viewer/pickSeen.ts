// Which corners and edges the pointer may pre-select: like Onshape, only ones you can see. A corner
// or edge point counts when it is no further from the camera than the surface the ray hit (plus a
// small tolerance), or when it lies on the border of the face that was hit. Otherwise an edge on the
// far side of a tube, projected near the pointer, would win over the face in front of it (Harel,
// 2026-11-13). Pure maths, so it is tested on its own.

// A point on screen (px) and its depth from the camera along the view (world units).
export type ScreenPoint = { x: number; y: number; d: number };

// How far behind the hit surface a corner or edge may lie and still count as seen: a few tenths
// of a mm, or two pixels' worth at that depth when zoomed out (world units are metres).
export const seenTolerance = (pixelWorld: number) => Math.max(0.0003, 2 * pixelWorld);

export const seen = (d: number, hitDepth: number, tol: number) => d <= hitDepth + tol;

// The nearest corner within `reach` px of (x, y) that `ok` lets through (-1: none), and its distance.
export function nearestCorner(pts: ScreenPoint[], x: number, y: number, reach: number, ok: (k: number, p: ScreenPoint) => boolean): { n: number; dist: number } {
  let dist = reach;
  let n = -1;
  pts.forEach((p, k) => {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < dist && ok(k, p)) [dist, n] = [d, k];
  });
  return { n, dist };
}

// The nearest point of a polyline to (x, y) on screen, piece by piece; a piece counts only when
// `ok` accepts its nearest point (its depth found along the piece) and `keep(j)` lets the piece in.
export function nearestOnLine(pts: ScreenPoint[], closed: boolean, x: number, y: number, ok: (p: ScreenPoint) => boolean, keep: (j: number) => boolean = () => true): number {
  let best = Infinity;
  const count = closed ? pts.length : pts.length - 1;
  for (let j = 0; j < count; j++) {
    if (!keep(j)) continue;
    const a = pts[j];
    const b = pts[(j + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const u = l2 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
    const p = { x: a.x + u * dx, y: a.y + u * dy, d: a.d + u * (b.d - a.d) };
    const dist = Math.hypot(p.x - x, p.y - y);
    if (dist < best && ok(p)) best = dist;
  }
  return best;
}
