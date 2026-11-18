// A comment's link to one face, edge or corner of a part (Harel, 2026-11-18, plan/cad-design-review.md).
// The viewer numbers a part's faces and edges from its mesh (src/lib/model/topology.ts); the numbers
// hold while the mesh is the same, not after a geometry change. So the anchor also keeps what the
// face / edge looked like (its signature, in the part's own frame, mm), and a newer mesh is searched
// for the closest match. When nothing matches, the comment's point (`at`, assembly mm) still places
// it. Pure: used by the browser (viewer/anchors.ts) and the server (checking what's sent).
import type { Topology, V3 } from "@/lib/model/topology";

export type AnchorKind = "face" | "edge" | "point";

// `k`: plane | cylinder | other (face), line | circle | other (edge), point. `c`: the face's middle
// (area-weighted), the edge's middle point, or the corner. `d`: a plane's normal, a cylinder's
// axis, a line's direction, a circle's normal. `r`: radius. `s`: area (mm²) or length (mm).
export type AnchorSig = { k: string; c: V3; d?: V3; r?: number; s?: number };
export type Anchor = { key: string; kind: AnchorKind; n: number; sig: AnchorSig; at: V3 };

const r2 = (x: number) => Math.round(x * 100) / 100;
const mm = (p: V3): V3 => [r2(p[0] * 1000), r2(p[1] * 1000), r2(p[2] * 1000)];
const unit = (d: V3): V3 => [Math.round(d[0] * 1e4) / 1e4, Math.round(d[1] * 1e4) / 1e4, Math.round(d[2] * 1e4) / 1e4];

// An edge's middle, whichever way it's listed: halfway along it, or a closed edge's centre.
function middle(pts: V3[], closed: boolean): V3 {
  if (closed || pts.length < 2) {
    const c: V3 = [0, 0, 0];
    for (const p of pts) for (const k of [0, 1, 2]) c[k] += p[k] / pts.length;
    return c;
  }
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1], p[2] - pts[i][2]));
  let left = seg.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? Math.min(1, left / seg[i]) : 0;
      return [0, 1, 2].map((k) => pts[i][k] + (pts[i + 1][k] - pts[i][k]) * f) as V3;
    }
    left -= seg[i];
  }
  return pts[0];
}

// The face / edge / corner `n` as an anchor signature. `pos` / `idx`: the part mesh's positions
// (metres, part frame) and triangle indices.
export function sigOf(t: Topology, pos: ArrayLike<number>, idx: ArrayLike<number>, kind: AnchorKind, n: number): AnchorSig | null {
  if (kind === "point") {
    const p = t.corners[n];
    return p ? { k: "point", c: mm(p) } : null;
  }
  if (kind === "edge") {
    const e = t.edges[n];
    if (!e) return null;
    const mid = middle(e.points, e.closed);
    const d = e.kind === "line" ? e.dir : e.kind === "circle" ? e.normal : undefined;
    return { k: e.kind, c: mm(mid), ...(d && { d: unit(d) }), ...(e.radius !== undefined && { r: r2(e.radius * 1000) }), s: r2(e.length * 1000) };
  }
  const f = t.faces[n];
  if (!f) return null;
  const c: V3 = [0, 0, 0];
  let total = 0;
  for (const tri of f.tris) {
    const a = idx[tri * 3] * 3, b = idx[tri * 3 + 1] * 3, q = idx[tri * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[q] - pos[a], vy = pos[q + 1] - pos[a + 1], vz = pos[q + 2] - pos[a + 2];
    const w = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    for (const k of [0, 1, 2]) c[k] += ((pos[a + k] + pos[b + k] + pos[q + k]) / 3) * w;
    total += w;
  }
  if (total > 0) for (const k of [0, 1, 2]) c[k] /= total;
  const d = f.kind === "plane" ? f.normal : f.kind === "cylinder" ? f.axis : undefined;
  return { k: f.kind, c: mm(c), ...(d && { d: unit(d) }), ...(f.radius !== undefined && { r: r2(f.radius * 1000) }), s: r2(f.area * 1e6) };
}

// How far apart two signatures are, in mm-ish units: their middles, plus penalties for turning,
// another radius or another size. Infinity when they're not the same kind of thing.
export function sigDistance(a: AnchorSig, b: AnchorSig) {
  if (a.k !== b.k) return Infinity;
  let d = Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1], a.c[2] - b.c[2]);
  if (a.d && b.d) d += (1 - Math.abs(a.d[0] * b.d[0] + a.d[1] * b.d[1] + a.d[2] * b.d[2])) * 200;
  if (a.r !== undefined && b.r !== undefined) d += Math.abs(a.r - b.r) * 2;
  if (a.s !== undefined && b.s !== undefined) d += (Math.abs(a.s - b.s) / Math.max(a.s, b.s, 1)) * 20;
  return d;
}

// Farther than this (see sigDistance) and it isn't the same face / edge any more.
export const MATCH_MM = 30;

// The face / edge / corner of this mesh that is the anchor's: its own number when it still looks
// the same, else the closest look-alike, else -1.
export function findAnchor(t: Topology, pos: ArrayLike<number>, idx: ArrayLike<number>, a: Pick<Anchor, "kind" | "n" | "sig">): number {
  const count = a.kind === "point" ? t.corners.length : a.kind === "edge" ? t.edges.length : t.faces.length;
  const same = a.n < count ? sigOf(t, pos, idx, a.kind, a.n) : null;
  if (same && sigDistance(same, a.sig) < 0.5) return a.n;
  let best = -1;
  let bestD = MATCH_MM;
  for (let n = 0; n < count; n++) {
    const s = sigOf(t, pos, idx, a.kind, n);
    const d = s ? sigDistance(s, a.sig) : Infinity;
    if (d < bestD) [best, bestD] = [n, d];
  }
  return best;
}

// An anchor as sent by a browser: kept only when every field is sound; numbers rounded.
const num = (x: unknown, lim = 1e6) => typeof x === "number" && Number.isFinite(x) && Math.abs(x) < lim;
const v3 = (x: unknown, lim = 1e6): x is V3 => Array.isArray(x) && x.length === 3 && x.every((n) => num(n, lim));
const KINDS = ["plane", "cylinder", "other", "line", "circle", "point"];
export function cleanAnchor(x: unknown): Anchor | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Record<string, unknown>;
  const s = a.sig as Record<string, unknown> | undefined;
  if (typeof a.key !== "string" || !a.key || a.key.length > 300) return null;
  if (a.kind !== "face" && a.kind !== "edge" && a.kind !== "point") return null;
  if (!Number.isInteger(a.n) || (a.n as number) < 0 || (a.n as number) > 1e7) return null;
  if (!v3(a.at, 1e5) || !s || typeof s.k !== "string" || !KINDS.includes(s.k) || !v3(s.c)) return null;
  if ((s.d !== undefined && !v3(s.d, 2)) || (s.r !== undefined && !num(s.r)) || (s.s !== undefined && !num(s.s, 1e12))) return null;
  const round = (p: V3): V3 => [r2(p[0]), r2(p[1]), r2(p[2])];
  return {
    key: a.key,
    kind: a.kind,
    n: a.n as number,
    sig: { k: s.k, c: round(s.c as V3), ...(s.d !== undefined && { d: s.d as V3 }), ...(s.r !== undefined && { r: s.r as number }), ...(s.s !== undefined && { s: s.s as number }) },
    at: round(a.at),
  };
}

export const anchorKindName = (a: Pick<Anchor, "kind" | "sig">) =>
  a.kind === "point" ? "Point" : a.kind === "edge" ? ({ line: "Straight edge", circle: "Round edge" }[a.sig.k] ?? "Edge") : ({ plane: "Flat face", cylinder: "Round face" }[a.sig.k] ?? "Face");
