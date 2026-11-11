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
  from: Axis | DefaultPlane | "face";
  normal: V3; // the reference's unit normal, before the tilt
  origin: V3; // a point on the reference: the model centre, or a point on the face
  offset: number; // mm along the (tilted) normal from `origin`
  tilt: [number, number]; // degrees about the plane's two in-plane axes (inPlaneAxes)
  flip: boolean; // false: the side the normal points to is cut away (into the part from a face)
};

export type Cut = CutPlane;

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

// A round face's section, Onshape's way: a flat plane through the face's axis, cutting the part
// lengthwise down the middle, its normal square to the axis and towards the viewer (`toViewer`,
// model frame: the camera direction with its part along the axis taken out; any square direction
// when looking straight down the axis). Its origin is on the axis, level with the clicked point,
// so the handle sits there (Harel, 2026-11-11).
export function roundFacePlane(axisPoint: V3, axis: V3, point: V3, toViewer: THREE.Vector3): CutPlane {
  const a = vec(axis).normalize();
  const o = vec(axisPoint);
  const foot = o.clone().addScaledVector(a, vec(point).sub(o).dot(a));
  const n = toViewer.clone().addScaledVector(a, -toViewer.dot(a));
  if (n.lengthSq() < 1e-12) n.copy(inPlaneAxes(a)[0]);
  return facePlane(foot.toArray() as V3, n.normalize().toArray() as V3);
}

// Whether a cut takes a point (model frame) away: the side in front of its (tilted) normal,
// behind it when flipped.
export const removedBy = (c: Cut, p: THREE.Vector3) => clipPlane(c).distanceToPoint(p) < 0;

// N, "view normal to": the direction (model frame, target → camera) to look at a cut from: from
// the side it cuts away, straight at the cut face.
export function viewDirection(c: Cut): THREE.Vector3 {
  const n = tiltedNormal(c);
  return c.flip ? n.negate() : n;
}

// Where the segment a→b crosses a cut, as a fraction along it, or null.
function crossing(pl: THREE.Plane, a: THREE.Vector3, b: THREE.Vector3): number | null {
  const fa = pl.distanceToPoint(a), fb = pl.distanceToPoint(b);
  return fa < 0 === fb < 0 ? null : fa / (fa - fb);
}

// The outline of a cut face, like Onshape's dark line round each cut: where one part copy's
// triangles (positions and index in the part's frame, `at` its placement) cross the cut, as line
// segments (model frame, 6 numbers each) pushed onto `out`. Pieces another cut takes away are
// left out; each point sits a hair towards the cut-away side so it draws over the cap.
export function contour(pos: ArrayLike<number>, index: ArrayLike<number>, at: THREE.Matrix4, c: Cut, others: Cut[], out: number[]): void {
  const pl = clipPlane(c);
  const gone = others.map((o) => clipPlane(o));
  // A hair (5 µm) towards the cut-away side: against the kept side's normal.
  const nudge = pl.normal.clone().multiplyScalar(-5e-6);
  const n = pos.length / 3;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(at));
  const mid = new THREE.Vector3();
  for (let t = 0; t + 2 < index.length; t += 3) {
    const hit: THREE.Vector3[] = [];
    for (let e = 0; e < 3 && hit.length < 2; e++) {
      const a = pts[index[t + e]], b = pts[index[t + ((e + 1) % 3)]];
      const s = crossing(pl, a, b);
      if (s !== null) hit.push(a.clone().lerp(b, s));
    }
    if (hit.length < 2) continue;
    mid.addVectors(hit[0], hit[1]).multiplyScalar(0.5);
    if (gone.some((g) => g.distanceToPoint(mid) < 0)) continue;
    const p = hit[0].add(nudge), q = hit[1].add(nudge);
    out.push(p.x, p.y, p.z, q.x, q.y, q.z);
  }
}
