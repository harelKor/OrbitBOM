// The section's plane maths, kept pure (no DOM, no renderer) so it is tested on its own. Every
// point and direction here is in the model's own frame: Onshape's, Z up, in metres (the frame of
// the placements and of `root` in stage.ts). Offsets shown to people are in mm.
import * as THREE from "three";
import type { V3 } from "@/lib/model/topology";

export type Axis = "x" | "y" | "z";

// One cutting plane, like Onshape's section plane: a reference (an axis through the model centre,
// or a flat face), an offset along its normal, a tilt, and which side is kept.
export type CutPlane = {
  from: Axis | "face";
  normal: V3; // the reference's unit normal, before the tilt
  origin: V3; // a point on the reference: the model centre, or a point on the face
  offset: number; // mm along the (tilted) normal from `origin`
  tilt: [number, number]; // degrees about the plane's two in-plane axes (inPlaneAxes)
  flip: boolean; // false: the side the normal points to is cut away (into the part from a face)
};

// What gets cut: every part, only the listed ones, or all but them (Onshape's Include / Exclude).
export type SectionParts = "all" | "only" | "except";
export type Section = { planes: CutPlane[]; parts: SectionParts; keys: string[] };

export const MAX_PLANES = 3;
// The cut sits 0.01 mm into the removed side, so a face the plane lies on stays drawn instead of
// flickering in and out.
const EPS = 1e-5;
const DEG = Math.PI / 180;

export const AXES: Record<Axis, V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
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
