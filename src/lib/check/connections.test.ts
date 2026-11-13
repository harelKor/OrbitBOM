import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { describe, expect, it } from "vitest";
import { sandboxStudio } from "@/lib/model/sandbox";
import { topology } from "@/lib/model/topology";
import { contacts, floating, holeOffsets, screwChecks, worldBoxes, type Inst } from "./connections";
import { cylinders } from "./features";

// The sandbox's parts, prepared as the viewer does: BVH and topology on each mesh.
const meshes = sandboxStudio();
const geo = (id: string) => {
  const m = meshes.find((x) => x.partId === id)!;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  g.boundsTree = new MeshBVH(g);
  g.userData.topology = topology(g.attributes.position.array, g.index!.array);
  return g;
};
const PLATE = geo("PLATE"); // 240 × 90 × 4 mm, 16 mm holes every 30 mm from 15 mm
const STANDOFF = geo("STANDOFF"); // Ø12.7 outside, Ø5 hole, 100 mm long along Z
const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
const inst = (key: string, name: string, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4): Inst => ({ key, name, geometry, matrix });

describe("round features", () => {
  it("finds the plate's holes and the standoff's bore and outside", () => {
    const holes = cylinders(PLATE).filter((c) => c.hole);
    expect(holes).toHaveLength(24);
    expect(holes[0].r).toBeCloseTo(0.008, 4);
    const so = cylinders(STANDOFF);
    expect(so.find((c) => c.hole)?.r).toBeCloseTo(0.0025, 4);
    expect(so.find((c) => !c.hole)?.r).toBeCloseTo(0.00635, 4);
  });
});

describe("connections", () => {
  it("finds a part that touches nothing", async () => {
    const list = [inst("a", "Plate A", PLATE, at(0, 0, 0)), inst("b", "Plate B", PLATE, at(0, 0, 0.004)), inst("c", "Lost plate", PLATE, at(1, 0, 0))];
    const boxes = worldBoxes(list);
    const touching = await contacts(list, boxes);
    expect(touching).toHaveLength(1);
    const f = floating(list, boxes, touching);
    expect(f).toHaveLength(1);
    expect(f[0].names).toEqual(["Lost plate"]);
  });

  it("finds holes of stacked plates half a millimetre apart, not lined-up ones", async () => {
    const off = [inst("a", "Plate A", PLATE, at(0, 0, 0)), inst("b", "Plate B", PLATE, at(0.0005, 0, 0.004))];
    const f = holeOffsets(off, await contacts(off, worldBoxes(off)));
    expect(f).toHaveLength(1);
    expect(f[0].copies).toBe(24);
    expect(f[0].text).toContain("0.5 mm off");
    const lined = [inst("a", "Plate A", PLATE, at(0, 0, 0)), inst("b", "Plate B", PLATE, at(0, 0, 0.004))];
    expect(holeOffsets(lined, await contacts(lined, worldBoxes(lined)))).toHaveLength(0);
  });

  it("checks a screw against its holes, its length, and joints held by one screw", () => {
    // A 12.7 mm "screw" (the standoff shape) through two plates' 16 mm holes: loose; sticking out.
    const list = [inst("a", "Plate A", PLATE, at(0, 0, 0)), inst("b", "Plate B", PLATE, at(0, 0, 0.004)), inst("s", "SHCS 1/2-13 x 4", STANDOFF, at(0.015, 0.015, -0.002))];
    const { findings, screws } = screwChecks(list, worldBoxes(list));
    expect(screws).toHaveLength(1);
    const kinds = findings.map((f) => f.kind);
    expect(kinds.filter((k) => k === "hole-size")).toHaveLength(2);
    expect(findings.find((f) => f.kind === "hole-size")?.text).toContain("loose");
    expect(findings.some((f) => f.kind === "screw-length" && f.text.includes("sticks out"))).toBe(true);
    expect(findings.find((f) => f.kind === "one-screw")?.names.sort()).toEqual(["Plate A", "Plate B"]);
  });
});
