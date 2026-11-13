import * as THREE from "three";
import type { Topology } from "@/lib/model/topology";

// The round features of a part (holes, shafts, screw heads) from its mesh's topology
// (src/lib/model/topology.ts): each round face with its radius and the stretch of its axis it
// covers. Onshape often splits one hole into two half faces: those are merged back into one.
// Part frame, metres; `worldCyl` puts one where a placed copy sits.

export type Cyl = {
  r: number;
  a: THREE.Vector3; // its axis from here…
  b: THREE.Vector3; // …to here
  hole: boolean; // the round face looks inwards (a hole, a bore); outwards: a shaft, a head
  area: number;
};

const cache = new WeakMap<THREE.BufferGeometry, Cyl[]>();

export function cylinders(geometry: THREE.BufferGeometry): Cyl[] {
  const kept = cache.get(geometry);
  if (kept) return kept;
  const topo = geometry.userData.topology as Topology | undefined;
  if (!topo) return [];
  const pos = geometry.attributes.position.array;
  const idx = geometry.index!.array;
  const v = new THREE.Vector3();
  const tri = new THREE.Triangle();
  const n = new THREE.Vector3();
  const found: { r: number; axis: THREE.Vector3; p: THREE.Vector3; lo: number; hi: number; hole: boolean; area: number }[] = [];
  for (const f of topo.faces) {
    if (f.kind !== "cylinder" || !f.axis || !f.point || !f.radius) continue;
    const axis = new THREE.Vector3(...f.axis).normalize();
    // One direction for every axis, so two halves of a hole agree.
    if (axis.x < -1e-9 || (Math.abs(axis.x) <= 1e-9 && (axis.y < -1e-9 || (Math.abs(axis.y) <= 1e-9 && axis.z < 0)))) axis.negate();
    const p = new THREE.Vector3(...f.point);
    let lo = Infinity;
    let hi = -Infinity;
    for (const t of f.tris) {
      for (let k = 0; k < 3; k++) {
        const s = v.fromArray(pos, idx[t * 3 + k] * 3).sub(p).dot(axis);
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
    }
    // Inward or outward: a facet's normal against the way out from the axis at its middle.
    const t0 = f.tris[0];
    tri.a.fromArray(pos, idx[t0 * 3] * 3);
    tri.b.fromArray(pos, idx[t0 * 3 + 1] * 3);
    tri.c.fromArray(pos, idx[t0 * 3 + 2] * 3);
    tri.getNormal(n);
    const mid = tri.getMidpoint(new THREE.Vector3());
    const out = mid.clone().sub(p);
    out.addScaledVector(axis, -out.dot(axis));
    found.push({ r: f.radius, axis, p, lo, hi, hole: n.dot(out) < 0, area: f.area });
  }
  // Merge faces on one axis with one radius whose stretches touch.
  const merged: typeof found = [];
  for (const c of found) {
    const same = merged.find((m) => m.hole === c.hole && Math.abs(m.r - c.r) < Math.max(2e-5, m.r * 0.01) && Math.abs(m.axis.dot(c.axis)) > 0.99999 && lineGap(m.p, m.axis, c.p) < Math.max(2e-5, m.r * 0.01));
    if (!same) {
      merged.push({ ...c });
      continue;
    }
    const shift = c.p.clone().sub(same.p).dot(same.axis);
    const lo = c.lo + shift;
    const hi = c.hi + shift;
    if (lo > same.hi + 1e-4 || hi < same.lo - 1e-4) {
      merged.push({ ...c });
      continue;
    }
    same.lo = Math.min(same.lo, lo);
    same.hi = Math.max(same.hi, hi);
    same.area += c.area;
  }
  const out = merged.map((m) => ({ r: m.r, a: m.p.clone().addScaledVector(m.axis, m.lo), b: m.p.clone().addScaledVector(m.axis, m.hi), hole: m.hole, area: m.area }));
  cache.set(geometry, out);
  return out;
}

// How far point q is from the line through p along unit `axis`.
function lineGap(p: THREE.Vector3, axis: THREE.Vector3, q: THREE.Vector3) {
  const d = q.clone().sub(p);
  return d.addScaledVector(axis, -d.dot(axis)).length();
}

export function worldCyl(c: Cyl, m: THREE.Matrix4): Cyl {
  return { ...c, a: c.a.clone().applyMatrix4(m), b: c.b.clone().applyMatrix4(m) };
}

export const axisOf = (c: Cyl) => c.b.clone().sub(c.a).normalize();
export const lengthOf = (c: Cyl) => c.b.distanceTo(c.a);

// Two round features on (nearly) one line: how far apart their axes are, or Infinity when the
// axes aren't parallel.
export function axisOffset(c: Cyl, d: Cyl): number {
  const u = axisOf(c);
  const w = axisOf(d);
  if (Math.abs(u.dot(w)) < 0.9995) return Infinity;
  const mid = d.a.clone().add(d.b).multiplyScalar(0.5);
  return lineGap(c.a, u, mid);
}

// Where d's stretch lies along c's axis (from c.a), as [lo, hi].
export function along(c: Cyl, d: Cyl): [number, number] {
  const u = axisOf(c);
  const s1 = d.a.clone().sub(c.a).dot(u);
  const s2 = d.b.clone().sub(c.a).dot(u);
  return [Math.min(s1, s2), Math.max(s1, s2)];
}
