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
