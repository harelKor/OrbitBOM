import * as THREE from "three";
import type { ExtendedTriangle, MeshBVH } from "three-mesh-bvh";
import { crossDepth, sharedFacePolygon } from "./clash";

// What two overlapping parts have in common, to draw in red like Onshape's interference
// (Harel, 2026-11-13): the surface of the overlap (each part's surface lying inside the other,
// and the faces they share side by side) and the line where their surfaces cross. Model space,
// metres. One pair at a time, on the page's thread: a few tens of milliseconds.

export type OverlapShape = { tris: Float32Array; lines: Float32Array; box: THREE.Box3 };
export type OverlapPart = { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 };

const MAX_TRIS = 150_000;

// Whether a point (model space) is inside a closed mesh: the nearest point of its surface faces
// away from it. Near an edge the nearest point can sit on two faces; rays settle those (an odd
// number of crossings along two skewed directions).
function insideOf(part: OverlapPart) {
  const bvh = part.geometry.boundsTree as MeshBVH;
  const pos = part.geometry.attributes.position.array;
  const idx = part.geometry.index!.array;
  const toLocal = part.matrix.clone().invert();
  const q = new THREE.Vector3();
  const tri = new THREE.Triangle();
  const nrm = new THREE.Vector3();
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const rays = [new THREE.Vector3(0.5773, 0.5774, 0.5775).normalize(), new THREE.Vector3(-0.3127, 0.8341, -0.4545).normalize()];
  const ray = new THREE.Ray();
  const byRays = () => {
    let votes = 0;
    for (const d of rays) {
      ray.set(q, d);
      let n = 0;
      for (const h of bvh.raycast(ray, THREE.DoubleSide)) if (h.distance > 1e-7) n++;
      if (n % 2 === 1) votes++;
    }
    return votes === 2;
  };
  return (p: THREE.Vector3) => {
    q.copy(p).applyMatrix4(toLocal);
    if (!bvh.closestPointToPoint(q, hit)) return false;
    if (hit.distance < 1e-7) return false; // on the surface: not inside
    const f = hit.faceIndex * 3;
    tri.a.fromArray(pos, idx[f] * 3);
    tri.b.fromArray(pos, idx[f + 1] * 3);
    tri.c.fromArray(pos, idx[f + 2] * 3);
    tri.getNormal(nrm);
    // The nearest point well inside a face: its side of that face decides.
    const toP = q.clone().sub(hit.point);
    const along = toP.dot(nrm) / hit.distance;
    if (Math.abs(along) > 0.99) return along < 0;
    return byRays();
  };
}

export function overlapShape(a: OverlapPart, b: OverlapPart): OverlapShape | null {
  const bvhA = a.geometry.boundsTree as MeshBVH | undefined;
  const bvhB = b.geometry.boundsTree as MeshBVH | undefined;
  if (!bvhA || !bvhB) return null;
  if (!a.geometry.boundingBox) a.geometry.computeBoundingBox();
  if (!b.geometry.boundingBox) b.geometry.computeBoundingBox();
  const boxA = a.geometry.boundingBox!.clone().applyMatrix4(a.matrix);
  const boxB = b.geometry.boundingBox!.clone().applyMatrix4(b.matrix);
  const common = boxA.clone().intersect(boxB);
  if (common.isEmpty()) return null;
  const pad = Math.max(1e-4, common.getSize(new THREE.Vector3()).length() * 0.01);
  common.expandByScalar(pad);

  // Pass 1, as the check does: which triangles of each cross the other's surface, the crossing
  // lines, and the faces they share facing the same way.
  const crossedA = new Set<number>();
  const crossedB = new Set<number>();
  const lines: number[] = [];
  const tris: number[] = [];
  const toLocal = a.matrix.clone().invert().multiply(b.matrix);
  const seg = new THREE.Line3();
  const v = new THREE.Vector3();
  const push = (out: number[], p: THREE.Vector3) => {
    v.copy(p).applyMatrix4(a.matrix);
    out.push(v.x, v.y, v.z);
  };
  bvhA.bvhcast(bvhB, toLocal, {
    intersectsTriangles: (t1: ExtendedTriangle, t2: ExtendedTriangle, i1: number, i2: number) => {
      if (crossDepth(t1, t2) > 1e-6 && t1.intersectsTriangle(t2, seg) && seg.distance() > 1e-6) {
        crossedA.add(i1);
        crossedB.add(i2);
        push(lines, seg.start);
        push(lines, seg.end);
        return false;
      }
      const poly = sharedFacePolygon(t1, t2, 1e-5);
      for (let k = 1; k + 1 < poly.length; k++) {
        push(tris, poly[0]);
        push(tris, poly[k]);
        push(tris, poly[k + 1]);
      }
      return false;
    },
  });

  // Pass 2: each part's surface inside the other, its triangles cut finer where it crosses over.
  const minSize = Math.min(2e-3, Math.max(2e-4, common.getSize(new THREE.Vector3()).length() / 40));
  // Cutting finer is only needed near where the surfaces cross; elsewhere a piece is all in or
  // all out, which its corners and middle tell.
  const crossBoxes: THREE.Box3[] = [];
  for (let i = 0; i < lines.length; i += 6) {
    crossBoxes.push(new THREE.Box3().setFromPoints([new THREE.Vector3(lines[i], lines[i + 1], lines[i + 2]), new THREE.Vector3(lines[i + 3], lines[i + 4], lines[i + 5])]).expandByScalar(minSize));
  }
  const nearCross = (b: THREE.Box3) => crossBoxes.some((x) => x.intersectsBox(b));
  const surfaceInside = (part: OverlapPart, crossed: Set<number>, other: OverlapPart) => {
    const inside = insideOf(other);
    const pos = part.geometry.attributes.position.array;
    const idx = part.geometry.index!.array;
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();
    const nodeBox = new THREE.Box3();
    const c = new THREE.Vector3();
    const keep = (x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, cut: boolean, depth: number) => {
      if (tris.length / 9 > MAX_TRIS) return;
      nodeBox.makeEmpty().expandByPoint(x).expandByPoint(y).expandByPoint(z);
      if (!nodeBox.intersectsBox(common)) return;
      c.copy(x).add(y).add(z).divideScalar(3);
      const lxy = x.distanceTo(y), lyz = y.distanceTo(z), lzx = z.distanceTo(x);
      const size = Math.max(lxy, lyz, lzx);
      const ic = inside(c);
      const split = size > minSize && depth < 30 && ((cut && nearCross(nodeBox)) || inside(x) !== ic || inside(y) !== ic || inside(z) !== ic);
      if (!split) {
        if (ic) tris.push(x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z);
        return;
      }
      // Halved across its longest edge, so long thin triangles don't turn into slivers.
      if (size === lxy) {
        const m = x.clone().add(y).multiplyScalar(0.5);
        keep(x, m, z, cut, depth + 1);
        keep(m, y, z, cut, depth + 1);
      } else if (size === lyz) {
        const m = y.clone().add(z).multiplyScalar(0.5);
        keep(x, y, m, cut, depth + 1);
        keep(x, m, z, cut, depth + 1);
      } else {
        const m = z.clone().add(x).multiplyScalar(0.5);
        keep(x, y, m, cut, depth + 1);
        keep(m, y, z, cut, depth + 1);
      }
    };
    for (let t = 0; t < idx.length / 3; t++) {
      p0.fromArray(pos, idx[3 * t] * 3).applyMatrix4(part.matrix);
      p1.fromArray(pos, idx[3 * t + 1] * 3).applyMatrix4(part.matrix);
      p2.fromArray(pos, idx[3 * t + 2] * 3).applyMatrix4(part.matrix);
      keep(p0.clone(), p1.clone(), p2.clone(), crossed.has(t), 0);
    }
  };
  surfaceInside(a, crossedA, b);
  surfaceInside(b, crossedB, a);
  if (!tris.length && !lines.length) return null;

  const box = new THREE.Box3();
  for (const list of [tris, lines]) for (let i = 0; i < list.length; i += 3) box.expandByPoint(v.set(list[i], list[i + 1], list[i + 2]));
  return { tris: new Float32Array(tris), lines: new Float32Array(lines), box };
}
