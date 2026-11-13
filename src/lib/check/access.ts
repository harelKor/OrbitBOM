import * as THREE from "three";
import type { MeshBVH } from "three-mesh-bvh";
import { GAP, type Inst, type Screw } from "./connections";
import { axisOf, cylinders, worldCyl } from "./features";
import { findingId, type DesignFinding } from "./types";

// Phase 3 of the Design check (Harel's list, 2026-11-13): screws you can't reach. From each screw
// head, rays go out along the screw's axis where a hex key or driver would go; round each nut,
// rays go out sideways where a wrench would. Whatever they hit first is in the way. Model space,
// metres.

const REACH = 0.1; // how far out a driver needs to be clear
const NO_ROOM = 0.012; // closer than this: not even an L-key's short arm
const SHORT = 0.04; // closer than this: an L-key, no driver
const NUT = /\bnuts?\b|nyloc|keps/i;

const pt = (v: THREE.Vector3): [number, number, number] => [v.x * 1000, v.y * 1000, v.z * 1000];

// The first part a ray meets within `far`, leaving out `skip`.
function firstHit(list: Inst[], boxes: THREE.Box3[], inverse: (i: number) => THREE.Matrix4, ray: THREE.Ray, far: number, skip: Set<number>): { j: number; d: number } | null {
  const seg = new THREE.Box3().expandByPoint(ray.origin).expandByPoint(ray.at(far, new THREE.Vector3()));
  const local = new THREE.Ray();
  let best: { j: number; d: number } | null = null;
  for (let j = 0; j < list.length; j++) {
    if (skip.has(j) || !boxes[j].intersectsBox(seg) || !ray.intersectsBox(boxes[j])) continue;
    const bvh = list[j].geometry.boundsTree as MeshBVH | undefined;
    if (!bvh) continue;
    const m = inverse(j);
    local.copy(ray).applyMatrix4(m);
    const hit = bvh.raycastFirst(local, THREE.DoubleSide);
    if (!hit) continue;
    // Back to model space: the parts are rigid, so distances carry over.
    const d = hit.point.applyMatrix4(list[j].matrix).distanceTo(ray.origin);
    if (d <= far && (!best || d < best.d)) best = { j, d };
  }
  return best;
}

export function accessChecks(list: Inst[], boxes: THREE.Box3[], screws: Screw[]): DesignFinding[] {
  const inv = new Map<number, THREE.Matrix4>();
  const inverse = (i: number) => inv.get(i) ?? (inv.set(i, list[i].matrix.clone().invert()), inv.get(i)!);
  const out: DesignFinding[] = [];
  const side = new THREE.Vector3();
  const ray = new THREE.Ray();

  for (const s of screws) {
    if (!s.head) continue;
    // The head's top: its end away from the shaft.
    const ha = s.head.a.clone();
    const hb = s.head.b.clone();
    const top = ha.clone().sub(s.from).dot(s.dir) < hb.clone().sub(s.from).dot(s.dir) ? ha : hb;
    const outward = s.dir.clone().negate();
    const start = top.clone().addScaledVector(outward, 3e-4);
    side.set(1, 0, 0);
    if (Math.abs(side.dot(outward)) > 0.9) side.set(0, 1, 0);
    side.cross(outward).normalize();
    const side2 = outward.clone().cross(side);
    const skip = new Set([s.i]);
    let hit: { j: number; d: number } | null = null;
    for (const [x, y] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ray.set(start.clone().addScaledVector(side, x * s.head.r * 0.5).addScaledVector(side2, y * s.head.r * 0.5), outward);
      const h = firstHit(list, boxes, inverse, ray, REACH, skip);
      if (h && (!hit || h.d < hit.d)) hit = h;
    }
    if (!hit || hit.d >= SHORT) continue;
    const keys = [list[s.i].key, list[hit.j].key];
    const room = (hit.d * 1000).toFixed(0);
    out.push({
      id: findingId(hit.d < NO_ROOM ? "no-room" : "short-key", keys),
      kind: "access",
      keys,
      names: [list[s.i].name, list[hit.j].name],
      text:
        hit.d < NO_ROOM
          ? `${list[s.i].name}: ${list[hit.j].name} is ${room} mm above the head, no room for a key.`
          : `${list[s.i].name}: ${list[hit.j].name} is ${room} mm above the head, so only an L-key reaches it (no driver).`,
      at: pt(top),
      level: hit.d < NO_ROOM ? "warn" : "info",
      copies: 1,
    });
  }

  // Nuts: a wrench needs room round them. Six rays out sideways from just past the nut's corners.
  for (let i = 0; i < list.length; i++) {
    if (!NUT.test(list[i].name)) continue;
    const hole = cylinders(list[i].geometry).filter((c) => c.hole).map((c) => worldCyl(c, list[i].matrix))[0];
    if (!hole) continue;
    const axis = axisOf(hole);
    const mid = hole.a.clone().add(hole.b).multiplyScalar(0.5);
    // The nut's size across its corners, from its box.
    const r = Math.max(hole.r * 1.6, (boxes[i].getSize(new THREE.Vector3()).length() / 2) * 0.7);
    side.set(1, 0, 0);
    if (Math.abs(side.dot(axis)) > 0.9) side.set(0, 1, 0);
    side.cross(axis).normalize();
    const blocked: number[] = [];
    let near: { j: number; d: number } | null = null;
    for (let k = 0; k < 6; k++) {
      const dir = side.clone().applyAxisAngle(axis, (k * Math.PI) / 3);
      ray.set(mid.clone().addScaledVector(dir, r + GAP), dir);
      const h = firstHit(list, boxes, inverse, ray, r * 1.5, new Set([i]));
      if (h) {
        blocked.push(h.j);
        if (!near || h.d < near.d) near = h;
      }
    }
    if (blocked.length < 5 || !near) continue;
    const keys = [list[i].key, list[near.j].key];
    out.push({
      id: findingId("nut-room", keys),
      kind: "access",
      keys,
      names: [list[i].name, list[near.j].name],
      text: `${list[i].name}: ${list[near.j].name} and other parts leave no room round it for a wrench.`,
      at: pt(mid),
      level: "info",
      copies: 1,
    });
  }
  return out;
}

