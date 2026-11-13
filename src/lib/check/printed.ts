import * as THREE from "three";
import type { MeshBVH } from "three-mesh-bvh";
import type { Topology } from "@/lib/model/topology";
import type { Inst } from "./connections";
import { axisOf, cylinders } from "./features";
import type { PartFacts } from "./weight";
import { findingId, type DesignFinding } from "./types";

// Phase 5 of the Design check (Harel's list, 2026-11-13): 3D-printed parts (a print machine in
// their processes). Printed flat on their biggest flat face: how thin their walls get, how much of
// them overhangs (needs supports), holes lying sideways (oval, and loaded across the layers, the
// weak way), and PLA holding a bearing.

const THIN = 1.2; // mm: three lines of a 0.4 mm nozzle
const SAMPLES = 400;
const BEARING_R = 8; // mm: bores this big hold bearings (or shafts that load the part)

export type PrintFacts = { minWallMm: number | null; overhang: number; sideways: number; bigBores: number };

// What a printed part looks like to a printer, in its own frame.
export function printFacts(geometry: THREE.BufferGeometry): PrintFacts {
  const pos = geometry.attributes.position.array;
  const idx = geometry.index!.array;
  const bvh = geometry.boundsTree as MeshBVH | undefined;
  const topo = geometry.userData.topology as Topology | undefined;
  const nt = idx.length / 3;
  const tri = new THREE.Triangle();
  const nrm = new THREE.Vector3();
  const mid = new THREE.Vector3();

  // Down: the biggest flat face lies on the bed.
  let down = new THREE.Vector3(0, 0, -1);
  let bed = -Infinity;
  const big = topo?.faces.filter((f) => f.kind === "plane" && f.normal).reduce<Topology["faces"][number] | null>((a, b) => (!a || b.area > a.area ? b : a), null);
  if (big?.normal && big.point) {
    down = new THREE.Vector3(...big.normal);
    bed = down.dot(new THREE.Vector3(...big.point));
  }

  // Overhangs: facing down more than 45° and not on the bed.
  let total = 0;
  let over = 0;
  const areas: number[] = [];
  for (let t = 0; t < nt; t++) {
    tri.a.fromArray(pos, idx[t * 3] * 3);
    tri.b.fromArray(pos, idx[t * 3 + 1] * 3);
    tri.c.fromArray(pos, idx[t * 3 + 2] * 3);
    const a = tri.getArea();
    areas.push(a);
    total += a;
    tri.getNormal(nrm);
    tri.getMidpoint(mid);
    if (nrm.dot(down) > Math.SQRT1_2 && down.dot(mid) < bed - 2e-4) over += a;
  }

  // Wall thickness: from spots spread over the surface (by area), a ray straight in to the other side.
  let minWall: number | null = null;
  if (bvh && total > 0) {
    const ray = new THREE.Ray();
    const step = total / SAMPLES;
    let acc = step / 2;
    let run = 0;
    for (let t = 0; t < nt && run < SAMPLES; t++) {
      acc += areas[t];
      if (acc < step) continue;
      acc -= step;
      run++;
      tri.a.fromArray(pos, idx[t * 3] * 3);
      tri.b.fromArray(pos, idx[t * 3 + 1] * 3);
      tri.c.fromArray(pos, idx[t * 3 + 2] * 3);
      tri.getNormal(nrm);
      tri.getMidpoint(mid);
      ray.set(mid.clone().addScaledVector(nrm, -1e-6), nrm.clone().negate());
      const hit = bvh.raycastFirst(ray, THREE.DoubleSide);
      if (!hit || hit.distance < 1e-5) continue;
      const mm = hit.distance * 1000;
      if (minWall == null || mm < minWall) minWall = mm;
    }
  }

  const holes = cylinders(geometry).filter((c) => c.hole);
  const sideways = holes.filter((c) => c.r * 1000 >= 1.5 && Math.abs(axisOf(c).dot(down)) < 0.3).length;
  const bigBores = holes.filter((c) => c.r * 1000 >= BEARING_R).length;
  return { minWallMm: minWall, overhang: total ? over / total : 0, sideways, bigBores };
}

export function printedChecks(list: Inst[], facts: Record<string, PartFacts>): DesignFinding[] {
  const out: DesignFinding[] = [];
  const done = new Set<string>();
  for (const it of list) {
    const f = facts[it.key];
    if (!f?.printed || done.has(it.key)) continue;
    done.add(it.key);
    const p = printFacts(it.geometry);
    const add = (code: string, text: string, level: "warn" | "info") => {
      if (!it.geometry.boundingBox) it.geometry.computeBoundingBox();
      const c = it.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(it.matrix);
      out.push({ id: findingId(code, [it.key]), kind: "printed", keys: [it.key], names: [it.name], text, at: [c.x * 1000, c.y * 1000, c.z * 1000], level, copies: 1 });
    };
    if (p.minWallMm != null && p.minWallMm < THIN) add("print-thin", `${it.name} has walls as thin as ${p.minWallMm.toFixed(1)} mm: under three lines of a 0.4 mm nozzle, weak and may not print.`, "warn");
    if (p.overhang > 0.08) add("print-overhang", `${it.name}: about ${Math.round(p.overhang * 100)}% of it overhangs when printed flat on its biggest face, so it needs supports. Another side down, or chamfers, may avoid them.`, "info");
    if (p.sideways > 0) add("print-sideways", `${it.name} has ${p.sideways} hole${p.sideways > 1 ? "s" : ""} lying sideways when printed flat: they come out a little oval, and a screw in them pulls across the layers (the weak way).`, "info");
    const material = `${f.onshapeMaterial ?? ""} ${f.material ?? ""}`;
    if (p.bigBores > 0 && /\bpla\b/i.test(material)) add("print-pla-bearing", `${it.name} is PLA and holds a bearing or shaft: PLA creeps and cracks under load; PETG, nylon or Onyx last longer.`, "info");
  }
  return out;
}
