import * as THREE from "three";
import type { Topology } from "@/lib/model/topology";
import { densityOf } from "./density";
import type { Inst } from "./connections";
import { meshVolume, type PartFacts } from "./weight";
import { findingId, type DesignFinding } from "./types";

// Phase 4 of the Design check (Harel's list, 2026-11-13): plates. A plate is found from its flat
// faces (its biggest face and the ones parallel to it span its thickness, small next to its size);
// its biggest face's border loops, flattened to 2D in mm, are its outline and its cut-outs. From
// those: how much was taken out, the thinnest web, the material round holes, and sharp inside
// corners a router can't cut. The stress test (stress.ts) reuses the outline.

export type Loop = { pts: [number, number][]; area: number; circle: { cx: number; cy: number; r: number } | null };
export type Plate = {
  t: number; // thickness, mm
  outer: Loop; // counter-clockwise
  inner: Loop[]; // clockwise (material on the left of every loop)
  frame: { origin: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; n: THREE.Vector3 }; // part frame, metres
  volumeCm3: number;
};

const cache = new WeakMap<THREE.BufferGeometry, Plate | null>();

export function plateOf(geometry: THREE.BufferGeometry): Plate | null {
  if (cache.has(geometry)) return cache.get(geometry)!;
  const plate = readPlate(geometry);
  cache.set(geometry, plate);
  return plate;
}

function readPlate(geometry: THREE.BufferGeometry): Plate | null {
  const topo = geometry.userData.topology as Topology | undefined;
  if (!topo) return null;
  const planes = topo.faces.map((f, i) => ({ f, i })).filter(({ f }) => f.kind === "plane" && f.normal && f.point);
  if (!planes.length) return null;
  const big = planes.reduce((a, b) => (b.f.area > a.f.area ? b : a));
  const n = new THREE.Vector3(...big.f.normal!);
  const at = (p: number[]) => n.x * p[0] + n.y * p[1] + n.z * p[2];
  const levels = planes.filter(({ f }) => Math.abs(n.dot(new THREE.Vector3(...f.normal!))) > 0.9999).map(({ f }) => at(f.point!));
  const t = (Math.max(...levels) - Math.min(...levels)) * 1000;
  if (!(t > 0.3 && t <= 13)) return null;

  // The big face's border: triangle edges used once inside the face, chained into loops.
  const pos = geometry.attributes.position.array;
  const idx = geometry.index!.array;
  const count = new Map<string, [number, number]>();
  for (const tri of big.f.tris) {
    for (let k = 0; k < 3; k++) {
      const a = idx[tri * 3 + k];
      const b = idx[tri * 3 + ((k + 1) % 3)];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (count.has(key)) count.delete(key);
      else count.set(key, [a, b]);
    }
  }
  const next = new Map<number, number>();
  for (const [a, b] of count.values()) next.set(a, b);
  const u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(u.dot(n)) > 0.9) u.set(0, 1, 0);
  u.sub(n.clone().multiplyScalar(u.dot(n))).normalize();
  const v = n.clone().cross(u);
  const origin = new THREE.Vector3(...big.f.point!);
  const flat = (i: number): [number, number] => {
    const p = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).sub(origin);
    return [p.dot(u) * 1000, p.dot(v) * 1000];
  };
  const loops: Loop[] = [];
  const seen = new Set<number>();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const pts: [number, number][] = [];
    let cur: number | undefined = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      pts.push(flat(cur));
      cur = next.get(cur);
    }
    if (pts.length >= 3) loops.push(makeLoop(pts));
  }
  if (!loops.length) return null;
  loops.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  const outer = orient(loops[0], true);
  const xs = outer.pts.map((p) => p[0]);
  const ys = outer.pts.map((p) => p[1]);
  const minSide = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (minSide < 5 * t) return null; // a block or a tube wall, not a plate
  return { t, outer, inner: loops.slice(1).map((l) => orient(l, false)), frame: { origin, u, v, n }, volumeCm3: meshVolume(pos, idx) * 1e6 };
}

function signedArea(pts: [number, number][]) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

function makeLoop(pts: [number, number][]): Loop {
  const area = signedArea(pts);
  // A round hole: every point one radius from the middle.
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const rs = pts.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const r = rs.reduce((s, x) => s + x, 0) / rs.length;
  const circle = pts.length >= 8 && rs.every((x) => Math.abs(x - r) < Math.max(0.05, r * 0.02)) ? { cx, cy, r } : null;
  return { pts, area, circle };
}

// Counter-clockwise for the outline, clockwise for cut-outs: material on the left of each.
function orient(l: Loop, ccw: boolean): Loop {
  return (l.area > 0) === ccw ? { ...l, area: Math.abs(l.area) } : { ...l, pts: [...l.pts].reverse(), area: Math.abs(l.area) };
}

// The shortest distance between two loops (from every corner of one to every side of the other).
export function loopGap(a: Loop, b: Loop): { d: number; at: [number, number] } {
  let best = { d: Infinity, at: [0, 0] as [number, number] };
  const one = (p: [number, number][], q: [number, number][]) => {
    for (const [x, y] of p) {
      for (let i = 0; i < q.length; i++) {
        const [ax, ay] = q[i];
        const [bx, by] = q[(i + 1) % q.length];
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const f = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
        const d = Math.hypot(x - ax - f * dx, y - ay - f * dy);
        if (d < best.d) best = { d, at: [(x + ax + f * dx) / 2, (y + ay + f * dy) / 2] };
      }
    }
  };
  one(a.pts, b.pts);
  one(b.pts, a.pts);
  return best;
}

const boxGap = (a: Loop, b: Loop) => {
  const box = (l: Loop) => {
    const xs = l.pts.map((p) => p[0]);
    const ys = l.pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const [a0, a1, a2, a3] = box(a);
  const [b0, b1, b2, b3] = box(b);
  return Math.hypot(Math.max(0, b0 - a2, a0 - b2), Math.max(0, b1 - a3, a1 - b3));
};

// Sharp inside corners: a right turn (material on the left) between two straight sides, where a
// round bit can't reach. Fillets come out as many short sides and don't count.
export function sharpCorners(l: Loop): [number, number][] {
  const out: [number, number][] = [];
  const n = l.pts.length;
  for (let i = 0; i < n; i++) {
    const p = l.pts[(i + n - 1) % n];
    const q = l.pts[i];
    const r = l.pts[(i + 1) % n];
    const ax = q[0] - p[0], ay = q[1] - p[1];
    const bx = r[0] - q[0], by = r[1] - q[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 0.8 || lb < 0.8) continue;
    const turn = Math.asin(Math.max(-1, Math.min(1, (ax * by - ay * bx) / (la * lb))));
    const straight = (ax * bx + ay * by) / (la * lb);
    if (turn < 0 && (straight < Math.cos((25 * Math.PI) / 180) || turn < -0.4)) out.push(q);
  }
  return out;
}

const ROUTER = new Set(["cnc"]);

export function plateChecks(list: Inst[], facts: Record<string, PartFacts>): DesignFinding[] {
  const out: DesignFinding[] = [];
  const done = new Set<string>();
  for (const it of list) {
    // One look per part: every copy of a plate is the same plate.
    if (done.has(it.key)) continue;
    done.add(it.key);
    const p = plateOf(it.geometry);
    if (!p) continue;
    const f = facts[it.key];
    if (f?.printed) continue; // printed parts: printed.ts
    const at = (x: number, y: number): [number, number, number] => {
      const w = p.frame.origin.clone().addScaledVector(p.frame.u, x / 1000).addScaledVector(p.frame.v, y / 1000).applyMatrix4(it.matrix);
      return [w.x * 1000, w.y * 1000, w.z * 1000];
    };
    const add = (code: string, text: string, where: [number, number] | null, level: "warn" | "info") =>
      out.push({ id: findingId(code, [it.key]), kind: "plate", keys: [it.key], names: [it.name], text, at: where ? at(...where) : null, level, copies: 1 });
    const t = p.t.toFixed(1);

    // How much was taken out of the plate's outline.
    const removed = 1 - (p.volumeCm3 * 1000) / (p.outer.area * p.t);
    const density = densityOf(f?.onshapeMaterial, f?.material);
    const metal = density != null && density > 2;
    const cut = p.inner.filter((l) => !l.circle || l.circle.r > 6);
    if (metal && p.outer.area > 15000 && removed < 0.08) {
      const grams = p.volumeCm3 * density! * 0.35;
      add("plate-solid", `${it.name} (${t} mm) isn't lightened: pocketing about a third of it would save about ${Math.round(grams)} g.`, null, "info");
    }
    // The thinnest web between cut-outs, and between a cut-out and the edge.
    const webMin = Math.max(1.5 * p.t, 2.5);
    let thin: { d: number; at: [number, number] } | null = null;
    for (let i = 0; i < cut.length; i++) {
      for (const other of [p.outer, ...cut.slice(i + 1)]) {
        if (boxGap(cut[i], other) > webMin) continue;
        const g = loopGap(cut[i], other);
        if (g.d < webMin && (!thin || g.d < thin.d)) thin = g;
      }
    }
    if (thin) add("plate-web", `${it.name}: a web only ${thin.d.toFixed(1)} mm wide (the plate is ${t} mm; aim for at least ${webMin.toFixed(1)} mm).`, thin.at, "warn");
    // Material round holes: bolt holes and bearing bores.
    let worst: { meat: number; r: number; at: [number, number] } | null = null;
    for (const h of p.inner) {
      if (!h.circle) continue;
      const need = h.circle.r > 6 ? 3 : Math.max(2, h.circle.r);
      for (const other of [p.outer, ...p.inner]) {
        if (other === h || boxGap(h, other) > need) continue;
        const g = loopGap(h, other);
        if (g.d < need && (!worst || g.d / need < worst.meat / Math.max(2, worst.r))) worst = { meat: g.d, r: h.circle.r, at: g.at };
      }
    }
    if (worst) add("plate-meat", `${it.name}: only ${worst.meat.toFixed(1)} mm of material beside a Ø${(worst.r * 2).toFixed(1)} ${worst.r > 6 ? "bore" : "hole"}.`, worst.at, "warn");
    // A router leaves its bit's radius in every inside corner.
    if (f?.machines?.some((m) => ROUTER.has(m))) {
      const corners = [...sharpCorners(p.outer), ...cut.flatMap(sharpCorners)];
      if (corners.length) add("plate-corner", `${it.name} has ${corners.length} sharp inside corner${corners.length > 1 ? "s" : ""}: the router leaves its bit's radius there (1.6 mm for a 1/8″ bit). Round them in CAD.`, corners[0], "warn");
    }
  }
  return out;
}
