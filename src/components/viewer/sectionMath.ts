// The section's plane maths, kept pure (no DOM, no renderer) so it is tested on its own. Every
// point and direction here is in the model's own frame: Onshape's, Z up, in metres (the frame of
// the placements and of `root` in stage.ts). Offsets shown to people are in mm.
import * as THREE from "three";
import type { V3 } from "@/lib/model/topology";

export type Axis = "x" | "y" | "z";
// Onshape's default planes, which a section uses when no face is picked.
export type DefaultPlane = "front" | "top" | "right";

// One cutting plane, like Onshape's section plane: a reference (a default plane through the model
// centre, or a flat face), an offset along its normal, a tilt, and which side is kept.
export type CutPlane = {
  kind?: "plane";
  from: Axis | DefaultPlane | "face";
  normal: V3; // the reference's unit normal, before the tilt
  origin: V3; // a point on the reference: the model centre, or a point on the face
  offset: number; // mm along the (tilted) normal from `origin`
  tilt: [number, number]; // degrees about the plane's two in-plane axes (inPlaneAxes)
  flip: boolean; // false: the side the normal points to is cut away (into the part from a face)
};

// A cylindrical section, from a round face: everything within (or beyond) a radius of the face's
// axis is cut away, like Onshape's section on a cylindrical face.
export type CutCylinder = {
  kind: "cylinder";
  origin: V3; // on the axis, level with the clicked point
  axis: V3; // unit
  ref: V3; // unit, at right angles to the axis, towards the clicked point (where the handle sits)
  radius: number; // the face's radius, mm
  offset: number; // mm added to the radius (the handle's arrow)
  flip: boolean; // false: the inside is cut away; true: the outside
};

export type Cut = CutPlane | CutCylinder;
export const isCylinder = (c: Cut): c is CutCylinder => c.kind === "cylinder";

// The section: up to 3 cuts (each cuts), and whether the Section view panel is open (then clicks
// on faces add cuts and the 3D handle shows). Every part is cut: no Include / Exclude
// (Harel, 2026-11-11).
export type Section = { planes: Cut[]; open: boolean };

export const MAX_PLANES = 3;
// The cut sits 0.01 mm into the removed side, so a face the plane lies on stays drawn instead of
// flickering in and out.
const EPS = 1e-5;
const DEG = Math.PI / 180;

export const AXES: Record<Axis, V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
// Each default plane's normal points to the side it cuts away, the side its standard view looks
// from (Front from -Y, Top from +Z, Right from +X), so the cut faces the camera there.
export const DEFAULT_PLANES: Record<DefaultPlane, V3> = { front: [0, -1, 0], top: [0, 0, 1], right: [1, 0, 0] };
const vec = (v: V3) => new THREE.Vector3(v[0], v[1], v[2]);

// Two unit axes in the plane of `n`, at right angles: u is the model axis least along n, flattened
// onto the plane (so a Z plane gets u = X, v = Y), and v = n × u.
export function inPlaneAxes(n: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
  const a = ax <= ay && ax <= az ? new THREE.Vector3(1, 0, 0) : ay <= az ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  const u = a.addScaledVector(n, -a.dot(n)).normalize();
  return [u, new THREE.Vector3().crossVectors(n, u)];
}

// The plane's normal after its tilt: turned about u by tilt[0], then about v by tilt[1].
export function tiltedNormal(p: CutPlane): THREE.Vector3 {
  const n = vec(p.normal).normalize();
  const [u, v] = inPlaneAxes(n);
  return n.applyAxisAngle(u, p.tilt[0] * DEG).applyAxisAngle(v, p.tilt[1] * DEG).normalize();
}

// Where the plane is: its tilted normal and the point on it straight out from the origin.
export function planeAt(p: CutPlane): { normal: THREE.Vector3; point: THREE.Vector3 } {
  const normal = tiltedNormal(p);
  return { normal, point: vec(p.origin).addScaledVector(normal, p.offset / 1000) };
}

// The clipping plane (model frame): three.js keeps the points at a positive distance, so the kept
// side is the one behind the normal, or in front of it when flipped.
export function clipPlane(p: CutPlane, out = new THREE.Plane()): THREE.Plane {
  const { normal, point } = planeAt(p);
  out.setFromNormalAndCoplanarPoint(p.flip ? normal : normal.negate(), point);
  out.constant += EPS;
  return out;
}

// The offsets (mm, whole) at which the plane still meets `box`: for the slider's ends.
export function offsetRange(p: CutPlane, box: THREE.Box3): [number, number] {
  if (box.isEmpty()) return [-100, 100];
  const n = tiltedNormal(p);
  const o = vec(p.origin);
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < 8; k++) {
    const c = new THREE.Vector3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z);
    const d = c.sub(o).dot(n) * 1000;
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [Math.floor(lo), Math.ceil(hi)];
}

// A plane across an axis through the model centre.
export function axisPlane(axis: Axis, box: THREE.Box3): CutPlane {
  const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  return { from: axis, normal: AXES[axis], origin: c.toArray() as V3, offset: 0, tilt: [0, 0], flip: false };
}

// A default plane through the model centre.
export function defaultPlane(name: DefaultPlane, box: THREE.Box3): CutPlane {
  const c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
  return { from: name, normal: DEFAULT_PLANES[name], origin: c.toArray() as V3, offset: 0, tilt: [0, 0], flip: false };
}

// A plane on a flat face (a point on it and its outward normal): at offset 0 it lies on the face,
// and a negative offset cuts into the part.
export function facePlane(point: V3, normal: V3): CutPlane {
  const n = vec(normal).normalize();
  return { from: "face", normal: n.toArray() as V3, origin: [...point], offset: 0, tilt: [0, 0], flip: false };
}

// Dragging the offset arrow: how far along the line (`at` + t·`dir`, dir a unit vector) is the
// point closest to the pointer's ray. Null when the ray runs along the line.
export function alongLine(rayOrigin: THREE.Vector3, rayDir: THREE.Vector3, at: THREE.Vector3, dir: THREE.Vector3): number | null {
  const r = rayDir.clone().normalize();
  const w = at.clone().sub(rayOrigin);
  const b = dir.dot(r);
  const denom = 1 - b * b;
  if (denom < 1e-6) return null;
  return (b * r.dot(w) - dir.dot(w)) / denom;
}

// Dragging a tilt ring: the angle (radians) about `axis` at which the pointer's ray meets the
// ring's plane (through `centre`, at right angles to the axis), measured from `ref` (a unit vector
// in that plane). Null when the ray runs along the plane.
export function ringAngle(rayOrigin: THREE.Vector3, rayDir: THREE.Vector3, centre: THREE.Vector3, axis: THREE.Vector3, ref: THREE.Vector3): number | null {
  const d = rayDir.dot(axis);
  if (Math.abs(d) < 1e-4) return null;
  const t = centre.clone().sub(rayOrigin).dot(axis) / d;
  const p = rayOrigin.clone().addScaledVector(rayDir, t).sub(centre);
  const side = new THREE.Vector3().crossVectors(axis, ref);
  return Math.atan2(p.dot(side), p.dot(ref));
}

// An angle in degrees, brought into (-180, 180].
export const wrapDeg = (a: number) => {
  const w = ((((a + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
};

// The cylinder's radius now, in metres (never below 0.1 mm, so dragging inwards can't turn it
// inside out).
export const cylinderRadius = (c: CutCylinder) => Math.max(0.1, c.radius + c.offset) / 1000;

// A cylindrical section on a round face: its axis (a point on it, unit direction), radius (m), a
// point clicked on the face and the face's outward normal there. The side the outward normal
// points to is cut away, like a plane on a flat face: a hole's inside, a shaft's outside.
export function faceCylinder(axisPoint: V3, axis: V3, radius: number, hit: V3, normal: V3): CutCylinder {
  const d = vec(axis).normalize();
  const h = vec(hit);
  const foot = vec(axisPoint).addScaledVector(d, h.clone().sub(vec(axisPoint)).dot(d));
  const out = h.clone().sub(foot);
  const ref = out.lengthSq() > 1e-14 ? out.clone().normalize() : inPlaneAxes(d)[0];
  const convex = vec(normal).dot(out) > 0;
  return { kind: "cylinder", origin: foot.toArray() as V3, axis: d.toArray() as V3, ref: ref.toArray() as V3, radius: Math.round(radius * 1e6) / 1000, offset: 0, flip: convex };
}

// Whether a cut takes a point (model frame) away. Matches the shaders: a plane keeps the side
// behind its (tilted) normal unless flipped; a cylinder takes its inside unless flipped.
export function removedBy(c: Cut, p: THREE.Vector3): boolean {
  if (!isCylinder(c)) return clipPlane(c).distanceToPoint(p) < 0;
  const d = p.clone().sub(vec(c.origin));
  const a = vec(c.axis);
  const r2 = d.lengthSq() - d.dot(a) ** 2;
  const r = cylinderRadius(c);
  return c.flip ? r2 > (r + EPS) ** 2 : r2 < Math.max(0, r - EPS) ** 2;
}

// The part of a cylinder's axis that a box spans: the middle point and the length (m), a little
// longer than the box so the cap tube covers every corner.
export function axisSpan(origin: V3, axis: V3, box: THREE.Box3): { centre: THREE.Vector3; length: number } {
  const o = vec(origin), a = vec(axis).normalize();
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < 8; k++) {
    const c = new THREE.Vector3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z);
    const t = c.sub(o).dot(a);
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return { centre: o.addScaledVector(a, (lo + hi) / 2), length: (hi - lo) * 1.05 + 1e-4 };
}

// Whether a cylinder's surface can meet a box: the radius lies between the box's nearest reach
// to the axis (a lower bound) and its farthest corner from it.
export function cylinderMeetsBox(c: CutCylinder, box: THREE.Box3): boolean {
  if (box.isEmpty()) return false;
  const o = vec(c.origin), a = vec(c.axis);
  const r = cylinderRadius(c);
  const toAxis = (p: THREE.Vector3) => {
    const d = p.clone().sub(o);
    return Math.sqrt(Math.max(0, d.lengthSq() - d.dot(a) ** 2));
  };
  const centre = box.getCenter(new THREE.Vector3());
  let far = 0, spread = 0;
  for (let k = 0; k < 8; k++) {
    const q = new THREE.Vector3(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z);
    far = Math.max(far, toAxis(q));
    const d = q.sub(centre);
    spread = Math.max(spread, Math.sqrt(Math.max(0, d.lengthSq() - d.dot(a) ** 2)));
  }
  return toAxis(centre) - spread <= r && far >= r;
}

// Where a ray meets a cylinder (both crossings, nearest first, in units of rayDir), or null.
export function rayCylinder(rayOrigin: THREE.Vector3, rayDir: THREE.Vector3, c: CutCylinder): [number, number] | null {
  const a = vec(c.axis);
  const w = rayOrigin.clone().sub(vec(c.origin));
  const d = rayDir.clone().addScaledVector(a, -rayDir.dot(a));
  const m = w.clone().addScaledVector(a, -w.dot(a));
  const A = d.lengthSq();
  if (A < 1e-12) return null;
  const B = 2 * d.dot(m);
  const C = m.lengthSq() - cylinderRadius(c) ** 2;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return [(-B - s) / (2 * A), (-B + s) / (2 * A)];
}

// The plane through a cylinder's axis, square to the view, that tells each line of sight's near
// crossing from its far one (exact for the orthographic camera, close for perspective); its unit
// normal points towards the camera. The caps use it: a cylinder shows its cut on one half only.
// `toCamera`: from the axis towards the camera (the view's back direction in ortho), one frame.
export function splitPlane(origin: THREE.Vector3, axis: THREE.Vector3, toCamera: THREE.Vector3, out = new THREE.Plane()): THREE.Plane {
  const n = toCamera.clone().addScaledVector(axis, -toCamera.dot(axis));
  if (n.lengthSq() < 1e-12) n.copy(inPlaneAxes(axis)[0]);
  return out.setFromNormalAndCoplanarPoint(n.normalize(), origin);
}

// N, "view normal to": the direction (model frame, target → camera) to look at a cut from. A plane
// from the side it cuts away, straight at the cut face; a cylinder along its axis.
export function viewDirection(c: Cut): THREE.Vector3 {
  if (isCylinder(c)) return vec(c.axis).normalize();
  const n = tiltedNormal(c);
  return c.flip ? n.negate() : n;
}

// How far a point (model frame) is on the kept side of a cut, in metres (negative: cut away).
export function keptBy(c: Cut): (p: THREE.Vector3) => number {
  if (!isCylinder(c)) {
    const pl = clipPlane(c);
    return (p) => pl.distanceToPoint(p);
  }
  const o = vec(c.origin), a = vec(c.axis).normalize(), r = cylinderRadius(c);
  const d = new THREE.Vector3();
  return (p) => {
    d.copy(p).sub(o);
    const off = Math.sqrt(Math.max(0, d.lengthSq() - d.dot(a) ** 2)) - r;
    return c.flip ? -off : off;
  };
}

// Where the segment a→b crosses a cut's surface, as fractions along it (0…1, in order): one for
// a plane, up to two for a cylinder.
function crossings(c: Cut, a: THREE.Vector3, b: THREE.Vector3): number[] {
  if (!isCylinder(c)) {
    const pl = clipPlane(c);
    const fa = pl.distanceToPoint(a), fb = pl.distanceToPoint(b);
    return fa < 0 === fb < 0 ? [] : [fa / (fa - fb)];
  }
  const o = vec(c.origin), ax = vec(c.axis).normalize(), r = cylinderRadius(c);
  const w = a.clone().sub(o), d = b.clone().sub(a);
  const wp = w.addScaledVector(ax, -w.dot(ax)), dp = d.addScaledVector(ax, -d.dot(ax));
  const A = dp.lengthSq(), B = 2 * wp.dot(dp), C = wp.lengthSq() - r * r;
  if (A < 1e-18) return [];
  const disc = B * B - 4 * A * C;
  if (disc <= 0) return [];
  const q = Math.sqrt(disc);
  return [(-B - q) / (2 * A), (-B + q) / (2 * A)].filter((t) => t > 0 && t < 1);
}

// The outline of a cut face, like Onshape's dark line round each cut: where one part copy's
// triangles (positions and index in the part's frame, `at` its placement) cross the cut, as line
// segments (model frame, 6 numbers each) pushed onto `out`. Crossings are found exactly on the
// triangles' edges and joined straight across each triangle. Pieces another cut takes away are
// left out; each point sits a hair (5 µm) towards the cut-away side so it draws over the cap.
export function contour(pos: ArrayLike<number>, index: ArrayLike<number>, at: THREE.Matrix4, c: Cut, others: Cut[], out: number[]): void {
  const f = keptBy(c);
  const gone = others.map(keptBy);
  const n = pos.length / 3;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(at));
  const mid = new THREE.Vector3();
  const nudge = (q: THREE.Vector3) => {
    // Down the slope of `f`, measured over 1 µm.
    const g = f(q);
    const grad = new THREE.Vector3(f(mid.copy(q).setX(q.x + 1e-6)) - g, f(mid.copy(q).setY(q.y + 1e-6)) - g, f(mid.copy(q).setZ(q.z + 1e-6)) - g);
    if (grad.lengthSq() > 0) q.addScaledVector(grad.normalize(), -5e-6);
    return q;
  };
  for (let t = 0; t + 2 < index.length; t += 3) {
    // The crossings in order round the triangle; between pairs the perimeter runs cut away.
    const hit: THREE.Vector3[] = [];
    let startsGone = false;
    for (let e = 0; e < 3; e++) {
      const a = pts[index[t + e]], b = pts[index[t + ((e + 1) % 3)]];
      if (e === 0) startsGone = f(a) < 0;
      for (const s of crossings(c, a, b)) hit.push(a.clone().lerp(b, s));
    }
    if (hit.length < 2) continue;
    // Starting on the cut-away side, the first crossing leaves it: pair it with the last.
    const pairs = startsGone ? hit.slice(1, -1).concat([hit[hit.length - 1], hit[0]]) : hit;
    for (let k = 0; k + 1 < pairs.length; k += 2) {
      mid.addVectors(pairs[k], pairs[k + 1]).multiplyScalar(0.5);
      if (gone.some((g) => g(mid) < 0)) continue;
      const p = nudge(pairs[k].clone()), q = nudge(pairs[k + 1].clone());
      out.push(p.x, p.y, p.z, q.x, q.y, q.z);
    }
  }
}
