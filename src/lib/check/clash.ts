import * as THREE from "three";
import type { ExtendedTriangle, MeshBVH } from "three-mesh-bvh";
import { pairKey, type Clash } from "./types";

// Interference: two placed parts whose solids overlap. Found where their surfaces cross: a part
// poking into another has triangles that go through the other's triangles. Parts that only touch
// (bolted face to face, an edge on a face) have triangles that meet but don't go through, so a
// crossing counts only when each triangle reaches past the other's plane on both sides by more
// than the export's accuracy. Flat faces are exact in the 3D export; round ones are within half a
// millimetre (build.ts asks Onshape for chordTolerance 0.0005 m), so two round faces must cross
// by more than that: a shaft in a bearing drawn at the same size isn't an overlap.

const FLAT_TOL = 0.05e-3; // m
const ROUND_TOL = 0.6e-3;
const ENOUGH = 5e-3;
const SHARED_MIN = 1e-6; // m²: 1 mm² of shared face before two parts count as overlapping
const SHARED_STOP = 1e-4; // m²: 100 mm² shared, clearly overlapping: stop looking // deeper than this the pair is clearly overlapping: stop looking for more

// Parts that overlap in CAD on purpose or by habit: a screw drawn at its full size in a tapped
// hole, a gear's teeth in another's, a belt on its pulley. Listed apart, so the real ones stand out.
const FASTENER = /\b(screws?|bolts?|shcs|bhcs|fhcs|shc|bhc|fhc|nuts?|nyloc|washers?|rivets?|inserts?|set ?screws?|threaded|tapped|helicoil|#\d+-\d+|m\d+(\.\d+)?\s*x\s*\d+|1\/4"?-20|10-32|8-32|6-32|4-40)\b/i;
const GEARS = /\b(gears?|pulleys?|sprockets?|belts?|chains?|timing|htd|gt2|gt3|racks?|pinions?)\b/i;
export function expectedOverlap(name: string): string | null {
  if (FASTENER.test(name)) return "screw or insert";
  if (GEARS.test(name)) return "gear, belt or chain";
  return null;
}

// How far a triangle reaches past a plane on its less-reaching side (≤ 0: all on one side).
function through(t: THREE.Triangle, plane: THREE.Plane): number {
  const a = plane.distanceToPoint(t.a);
  const b = plane.distanceToPoint(t.b);
  const c = plane.distanceToPoint(t.c);
  return Math.min(Math.max(a, b, c), -Math.min(a, b, c));
}

const p1 = new THREE.Plane();
const p2 = new THREE.Plane();
const n = new THREE.Vector3();
// How deep two triangles (in one frame) cross: the smaller of how far each goes through the
// other's plane; ≤ 0 when they don't cross. Degenerate triangles never cross.
export function crossDepth(t1: THREE.Triangle, t2: THREE.Triangle): number {
  if (t1.getNormal(n).lengthSq() === 0 || t2.getNormal(n).lengthSq() === 0) return 0;
  t2.getPlane(p2);
  const d1 = through(t1, p2);
  if (d1 <= 0) return 0;
  t1.getPlane(p1);
  return Math.max(0, Math.min(d1, through(t2, p1)));
}

// Two triangles on one plane facing the same way: both solids lie behind it there, so where the
// triangles overlap the parts overlap too (two plates of one thickness overlapping side by side,
// two tubes sharing a face). Facing opposite ways is a part resting on another. Returns the
// overlapping area (m²), 0 when they aren't like that.
const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
const m1 = new THREE.Vector3();
export function sharedFaceArea(t1: THREE.Triangle, t2: THREE.Triangle, tol: number): number {
  const poly = sharedFlat(t1, t2, tol);
  return poly ? Math.abs(area(poly)) : 0;
}

// The same overlap as points in 3D (t1's frame), for drawing it (overlap.ts); empty when none.
export function sharedFacePolygon(t1: THREE.Triangle, t2: THREE.Triangle, tol: number): THREE.Vector3[] {
  const poly = sharedFlat(t1, t2, tol);
  if (!poly || poly.length < 3) return [];
  const c = p1.constant;
  return poly.map(([x, y]) => new THREE.Vector3().addScaledVector(e1, x).addScaledVector(e2, y).addScaledVector(m1, -c));
}

function sharedFlat(t1: THREE.Triangle, t2: THREE.Triangle, tol: number): P2[] | null {
  t1.getNormal(m1);
  t2.getNormal(n);
  if (m1.dot(n) < 0.9999) return null;
  t1.getPlane(p1);
  if (Math.abs(p1.distanceToPoint(t2.a)) > tol || Math.abs(p1.distanceToPoint(t2.b)) > tol || Math.abs(p1.distanceToPoint(t2.c)) > tol) return null;
  // Into the plane's 2D frame, then clip one triangle by the other.
  e1.subVectors(t1.b, t1.a).normalize();
  e2.crossVectors(m1, e1);
  const flat = (t: THREE.Triangle) => [t.a, t.b, t.c].map((v) => [e1.dot(v), e2.dot(v)] as [number, number]);
  return clip(ccw(flat(t2)), ccw(flat(t1)));
}

type P2 = [number, number];
function area(poly: P2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}
const ccw = (t: P2[]) => (area(t) < 0 ? [...t].reverse() : t);
// Sutherland–Hodgman: `subject` clipped by the convex counter-clockwise `by`.
function clip(subject: P2[], by: P2[]): P2[] {
  let out = subject;
  for (let i = 0; i < by.length && out.length; i++) {
    const [ax, ay] = by[i];
    const [bx, by_] = by[(i + 1) % by.length];
    const side = ([x, y]: P2) => (bx - ax) * (y - ay) - (by_ - ay) * (x - ax);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
  }
  return out;
}

export type ClashInstance = {
  key: string;
  name: string;
  geometry: THREE.BufferGeometry; // with its BVH (geometry.boundsTree, load.ts)
  matrix: THREE.Matrix4; // where this copy sits, model space (m)
  flat?: (tri: number) => boolean; // the triangle lies on a flat face (topology.ts); unknown: round
};

type Box = { i: number; box: THREE.Box3 };

// The stretch of the planes' meeting line (direction lineX/Y/Z) that a triangle covers, given its
// corners' distances to the other plane (some on each side): where its edges cross that plane,
// measured along the line. `out`: from, to, then one crossing point's position along the line and
// its x, y, z. False when it doesn't really cross.
let lineX = 0, lineY = 0, lineZ = 0;
const s1 = new Float64Array(6);
const s2 = new Float64Array(6);
function span(t: THREE.Triangle, da: number, db: number, dc: number, out: Float64Array): boolean {
  let lo = Infinity;
  let hi = -Infinity;
  let found = 0;
  const at = (x: number, y: number, z: number) => {
    const s = x * lineX + y * lineY + z * lineZ;
    if (!found) {
      out[2] = s;
      out[3] = x;
      out[4] = y;
      out[5] = z;
    }
    found++;
    if (s < lo) lo = s;
    if (s > hi) hi = s;
  };
  const cross = (p: THREE.Vector3, q: THREE.Vector3, dp: number, dq: number) => {
    if (dp === 0) at(p.x, p.y, p.z);
    else if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)) {
      const f = dp / (dp - dq);
      at(p.x + f * (q.x - p.x), p.y + f * (q.y - p.y), p.z + f * (q.z - p.z));
    }
  };
  cross(t.a, t.b, da, db);
  cross(t.b, t.c, db, dc);
  cross(t.c, t.a, dc, da);
  out[0] = lo;
  out[1] = hi;
  return found >= 2;
}

// Each triangle's plane in its mesh's own frame: normal and offset (n·p = c), 4 numbers a triangle;
// a zero normal for a degenerate one. Kept per mesh for the whole run.
const planeCache = new WeakMap<THREE.BufferGeometry, Float32Array>();
function planesOf(g: THREE.BufferGeometry): Float32Array {
  let out = planeCache.get(g);
  if (out) return out;
  const pos = g.attributes.position.array;
  const idx = g.index!.array;
  out = new Float32Array((idx.length / 3) * 4);
  const t = new THREE.Triangle();
  for (let i = 0; i < idx.length / 3; i++) {
    t.a.fromArray(pos, idx[3 * i] * 3);
    t.b.fromArray(pos, idx[3 * i + 1] * 3);
    t.c.fromArray(pos, idx[3 * i + 2] * 3);
    t.getNormal(n);
    out[4 * i] = n.x;
    out[4 * i + 1] = n.y;
    out[4 * i + 2] = n.z;
    out[4 * i + 3] = n.dot(t.a);
  }
  planeCache.set(g, out);
  return out;
}

const sameMatrix = (a: THREE.Matrix4, b: THREE.Matrix4) => a.elements.every((x, i) => Math.abs(x - b.elements[i]) < 1e-7);

// Every overlapping pair of parts, worst first. `pause` lets the page draw between pairs (the
// work runs on the page's thread, where the meshes are); `progress` reports pairs done.
export async function findClashes(
  list: ClashInstance[],
  opts: { ignored?: Set<string>; pause?: () => Promise<void>; progress?: (done: number, total: number) => void } = {},
): Promise<Clash[]> {
  const boxes: Box[] = list.map((it, i) => {
    if (!it.geometry.boundingBox) it.geometry.computeBoundingBox();
    return { i, box: it.geometry.boundingBox!.clone().applyMatrix4(it.matrix) };
  });
  const world = boxes.map((b) => b.box); // by instance, kept before the sort below
  // Pairs whose boxes overlap (sweep along x).
  boxes.sort((a, b) => a.box.min.x - b.box.min.x);
  const pairs: [number, number][] = [];
  for (let s = 0; s < boxes.length; s++) {
    const A = boxes[s];
    for (let t = s + 1; t < boxes.length && boxes[t].box.min.x <= A.box.max.x; t++) {
      const B = boxes[t];
      if (!A.box.intersectsBox(B.box)) continue;
      if (opts.ignored?.has(pairKey(list[A.i].key, list[B.i].key))) continue;
      pairs.push([A.i, B.i]);
    }
  }

  const found = new Map<string, Clash>();
  const add = (a: ClashInstance, b: ClashInstance, depth: number, at: THREE.Vector3, same = false, flush = false) => {
    const k = pairKey(a.key, b.key);
    const was = found.get(k);
    const mm = Math.round(depth * 1e4) / 10;
    if (was) {
      was.copies++;
      if (flush) was.flush = true;
      if (mm > was.depthMm) {
        was.depthMm = mm;
        was.at = [at.x * 1000, at.y * 1000, at.z * 1000];
      }
      return;
    }
    const [x, y] = a.key < b.key ? [a, b] : [b, a];
    found.set(k, {
      a: x.key,
      b: y.key,
      aName: x.name,
      bName: y.name,
      depthMm: mm,
      at: [at.x * 1000, at.y * 1000, at.z * 1000],
      copies: 1,
      expected: expectedOverlap(a.name) ?? expectedOverlap(b.name),
      ...(same && { same: true }),
      ...(flush && { flush: true }),
    });
  };

  const toLocal = new THREE.Matrix4();
  const inv = new THREE.Matrix4();
  const best = new THREE.Vector3();
  for (let p = 0; p < pairs.length; p++) {
    const a = list[pairs[p][0]];
    const b = list[pairs[p][1]];
    // The same part placed twice in the same spot: every face coincides, so nothing crosses.
    if (a.geometry === b.geometry && sameMatrix(a.matrix, b.matrix)) {
      const size = a.geometry.boundingBox!.getSize(new THREE.Vector3());
      add(a, b, Math.min(size.x, size.y, size.z), a.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(a.matrix), true);
    } else {
      const bvhA = a.geometry.boundsTree as MeshBVH | undefined;
      const bvhB = b.geometry.boundsTree as MeshBVH | undefined;
      if (bvhA && bvhB) {
        toLocal.copy(inv.copy(a.matrix).invert()).multiply(b.matrix);
        let deepest = 0;
        let shared = 0;
        // Called for every pair of triangles in overlapping BVH leaves, which for parts resting on
        // each other is a lot: the planes of `a`'s triangles are worked out once per mesh, `b`'s
        // once per triangle (the outer loop), and most pairs stop after three dot products.
        const planes = planesOf(a.geometry);
        let lastI2 = -1;
        let n2x = 0, n2y = 0, n2z = 0, c2 = 0;
        bvhA.bvhcast(bvhB, toLocal, {
          intersectsTriangles: (t1: ExtendedTriangle, t2: ExtendedTriangle, i1: number, i2: number) => {
            if (i2 !== lastI2) {
              lastI2 = i2;
              t2.getNormal(n);
              n2x = n.x; n2y = n.y; n2z = n.z;
              c2 = n.dot(t2.a);
            }
            const k = i1 * 4;
            const n1x = planes[k], n1y = planes[k + 1], n1z = planes[k + 2];
            if ((n2x === 0 && n2y === 0 && n2z === 0) || (n1x === 0 && n1y === 0 && n1z === 0)) return false;
            // t1 against t2's plane.
            const da = n2x * t1.a.x + n2y * t1.a.y + n2z * t1.a.z - c2;
            const db = n2x * t1.b.x + n2y * t1.b.y + n2z * t1.b.z - c2;
            const dc = n2x * t1.c.x + n2y * t1.c.y + n2z * t1.c.z - c2;
            const hi = Math.max(da, db, dc);
            const lo = Math.min(da, db, dc);
            if (hi <= 0 || lo >= 0) {
              // Not through: maybe lying on it, facing the same way (a shared face).
              if (hi - lo <= ROUND_TOL && Math.abs(hi) <= ROUND_TOL && n1x * n2x + n1y * n2y + n1z * n2z > 0.9999) {
                const tol = a.flat?.(i1) || b.flat?.(i2) ? FLAT_TOL : ROUND_TOL;
                shared += sharedFaceArea(t1, t2, tol);
              }
              return shared > SHARED_STOP; // plenty to call it an overlap: stop here
            }
            // t2 against t1's plane.
            const c1 = planes[k + 3];
            const ea = n1x * t2.a.x + n1y * t2.a.y + n1z * t2.a.z - c1;
            const eb = n1x * t2.b.x + n1y * t2.b.y + n1z * t2.b.z - c1;
            const ec = n1x * t2.c.x + n1y * t2.c.y + n1z * t2.c.z - c1;
            const d = Math.min(hi, -lo, Math.max(ea, eb, ec), -Math.min(ea, eb, ec));
            if (d <= FLAT_TOL || d <= deepest) return false;
            const tol = a.flat?.(i1) || b.flat?.(i2) ? FLAT_TOL : ROUND_TOL;
            if (d <= tol) return false;
            // Each reaching through the other's plane isn't enough: a bellypan's edge and a tube's
            // side wall standing on it do that and only meet at a point on their edges. Parts that
            // really overlap share a stretch of the line where the two planes meet.
            lineX = n1y * n2z - n1z * n2y;
            lineY = n1z * n2x - n1x * n2z;
            lineZ = n1x * n2y - n1y * n2x;
            const len = Math.hypot(lineX, lineY, lineZ);
            if (len < 1e-9) return false;
            lineX /= len; lineY /= len; lineZ /= len;
            if (!span(t1, da, db, dc, s1) || !span(t2, ea, eb, ec, s2)) return false;
            const from = Math.max(s1[0], s2[0]);
            const to = Math.min(s1[1], s2[1]);
            if (to - from <= tol) return false;
            deepest = d;
            // The middle of the shared stretch, from a point on the line.
            const m = (from + to) / 2 - s1[2];
            best.set(s1[3] + m * lineX, s1[4] + m * lineY, s1[5] + m * lineZ);
            return deepest > ENOUGH;
          },
        });
        // Only shared faces: the pin goes in the middle of where the two parts' boxes overlap.
        const at = deepest > 0 ? best.clone().applyMatrix4(a.matrix) : world[pairs[p][0]].clone().intersect(world[pairs[p][1]]).getCenter(new THREE.Vector3());
        if (deepest > 0 || shared > SHARED_MIN) add(a, b, deepest, at, false, shared > SHARED_MIN);
      }
    }
    opts.progress?.(p + 1, pairs.length);
    await opts.pause?.();
  }
  // Real overlaps first, deepest first; the expected kinds after them.
  return [...found.values()].sort((x, y) => Number(!!x.expected) - Number(!!y.expected) || y.depthMm - x.depthMm);
}
