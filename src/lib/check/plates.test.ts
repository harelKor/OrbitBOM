import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { describe, expect, it } from "vitest";
import { sandboxStudio } from "@/lib/model/sandbox";
import { topology } from "@/lib/model/topology";
import { loopGap, plateChecks, plateOf, sharpCorners, type Loop } from "./plates";
import { printedChecks, printFacts } from "./printed";

const prep = (g: THREE.BufferGeometry) => {
  g.userData.topology = topology(g.attributes.position.array, g.index!.array);
  return g;
};
const sandbox = (id: string) => {
  const m = sandboxStudio().find((x) => x.partId === id)!;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setIndex(new THREE.BufferAttribute(m.indices, 1));
  return prep(g);
};
const loop = (pts: [number, number][]): Loop => ({ pts, area: 0, circle: null });
const inst = (key: string, name: string, geometry: THREE.BufferGeometry) => ({ key, name, geometry, matrix: new THREE.Matrix4() });

describe("plates", () => {
  it("reads the sandbox gusset: 4 mm thick, its outline and 24 round holes", () => {
    const p = plateOf(sandbox("PLATE"))!;
    expect(p.t).toBeCloseTo(4, 1);
    expect(p.outer.area).toBeCloseTo(240 * 90, -1);
    expect(p.inner).toHaveLength(24);
    expect(p.inner.every((l) => l.circle && Math.abs(l.circle.r - 8) < 0.1)).toBe(true);
    expect(plateOf(sandbox("TUBE_L"))).toBeNull(); // a tube isn't a plate
  });

  it("calls out a solid aluminium plate, not a lightened one", () => {
    const solid = prep(new THREE.BoxGeometry(0.3, 0.2, 0.006));
    const facts = { s: { material: "6061 Aluminum", onshapeMaterial: null, printed: false, setG: null }, g: { material: "6061 Aluminum", onshapeMaterial: null, printed: false, setG: null } };
    const f = plateChecks([inst("s", "Side plate", solid), inst("g", "Gusset", sandbox("PLATE"))], facts);
    expect(f.map((x) => x.id)).toEqual(["plate-solid|s|"]);
    expect(f[0].text).toContain("isn't lightened");
  });

  it("measures webs and finds sharp inside corners", () => {
    const a = loop([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const b = loop([[13, 0], [20, 0], [20, 10], [13, 10]]);
    expect(loopGap(a, b).d).toBeCloseTo(3);
    // A square pocket walked clockwise (material on its left): all four corners are sharp.
    expect(sharpCorners(loop([[0, 0], [0, 10], [10, 10], [10, 0]]))).toHaveLength(4);
    // The plate's own outline, counter-clockwise: convex corners are fine.
    expect(sharpCorners(loop([[0, 0], [10, 0], [10, 10], [0, 10]]))).toHaveLength(0);
  });
});

describe("printed parts", () => {
  const bvh = (g: THREE.BufferGeometry) => {
    g.boundsTree = new MeshBVH(g);
    return g;
  };
  const pla = { material: "PLA", onshapeMaterial: null, printed: true, setG: null };
  it("finds thin walls, and stands a standoff on its end (hole upright)", () => {
    const sheet = bvh(prep(new THREE.BoxGeometry(0.05, 0.05, 0.001)));
    expect(printFacts(sheet).minWallMm).toBeCloseTo(1, 1);
    const f = printedChecks([inst("s", "Shim", sheet)], { s: pla });
    expect(f.map((x) => x.id)).toContain("print-thin|s|");
    const so = bvh(sandbox("STANDOFF"));
    const p = printFacts(so);
    expect(p.minWallMm).toBeGreaterThan(3);
    expect(p.sideways).toBe(0);
    expect(printedChecks([inst("x", "Not printed", sheet)], { x: { ...pla, printed: false } })).toHaveLength(0);
  });
});
