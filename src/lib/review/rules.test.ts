import { describe, expect, it } from "vitest";
import { sizeOf, suggestSetup, wallThickness, type Learned, type SetupInput } from "./rules";

const part = (over: Partial<SetupInput> = {}): SetupInput => ({
  classification: "cots",
  material: null,
  preProcess: null,
  process1: null,
  process2: null,
  geometry: null,
  ...over,
});
const none: Learned = new Map();

describe("suggestSetup", () => {
  it("maps a flat aluminum part to the plate of its thickness and the default process", () => {
    const s = suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [3.02, 120, 200] } }), none);
    expect(s?.changes).toEqual({ material: "3mm 6061-T6", preProcess: null, process1: "cnc", process2: null, classification: "inhouse" });
    expect(s?.reason).toContain("3 mm thick");
  });

  it("tells 6.35 mm from 6.7 mm plates", () => {
    const s = suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [6.7, 50, 80] } }), none);
    expect(s?.changes.material).toBe("6.7mm 6061-T6");
  });

  it("leaves a thick block or an unknown thickness alone", () => {
    expect(suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [20, 30, 40] } }), none)).toBeNull();
    expect(suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [7.3, 60, 90] } }), none)).toBeNull();
    expect(suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061" } }), none)).toBeNull();
  });

  it("prefers what the team usually does with the material", () => {
    const learned: Learned = new Map([["3mm Poly", { process1: "hadasas", count: 4 }]]);
    const s = suggestSetup(part({ geometry: { onshapeMaterial: "Polycarbonate", bbox: [3, 100, 100] } }), learned);
    expect(s?.changes.process1).toBe("hadasas");
    expect(s?.reason).toContain("as on 4 other 3mm Poly parts");
  });

  it("recognises 3D printed parts by their Onshape material", () => {
    expect(suggestSetup(part({ geometry: { onshapeMaterial: "PLA" } }), none)?.changes).toMatchObject({ material: "PLA", process1: "3d-bambu" });
    expect(suggestSetup(part({ geometry: { onshapeMaterial: "Onyx" } }), none)?.changes).toMatchObject({ material: "Onyx", process1: "3d-markforged" });
  });

  it("only adds processes to a part that has a material, and keeps processes someone set", () => {
    expect(suggestSetup(part({ classification: "inhouse", material: "2mm Poly" }), none)?.changes).toEqual({
      preProcess: null,
      process1: "laser",
      process2: null,
    });
    expect(suggestSetup(part({ material: "2mm Poly", process1: "cnc" }), none)).toBeNull();
    expect(suggestSetup(part({ classification: "external", geometry: { onshapeMaterial: "PLA" } }), none)).toBeNull();
  });

  it("treats bent sheet as a plate of its wall thickness, then bending", () => {
    const s = suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [19, 19, 200], wallMm: 2.01, sheetMetal: { flatPartId: "JFD" } } }), none);
    expect(s?.changes).toMatchObject({ material: "2mm 6061-T6", process1: "cnc", process2: "bending" });
    expect(s?.reason).toContain("bent sheet metal and 2 mm thick");
  });

  it("does not add bending twice or to a flat plate", () => {
    const learned: Learned = new Map([["2mm 6061-T6", { process1: "laser", process2: "bending", count: 3 }]]);
    const bent = suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [19, 19, 200], wallMm: 2 } }), learned);
    expect(bent?.changes).toMatchObject({ process1: "laser", process2: "bending" });
    const flat = suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [2, 60, 200] } }), none);
    expect(flat?.changes).toMatchObject({ process1: "cnc", process2: null });
  });
});

// A prism in metres: `rects` (mm, [x0, y0, x1, y1]) are the cross-section, extruded `len` mm
// along z. Faces shared between rects are left out, so it is one closed solid.
function prism(outline: [number, number][], rects: number[][], len: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    const i = pos.length / 3;
    pos.push(...[a, b, c, d].flat().map((x) => x / 1000));
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  };
  outline.forEach(([x, y], k) => {
    const [x2, y2] = outline[(k + 1) % outline.length];
    quad([x, y, 0], [x2, y2, 0], [x2, y2, len], [x, y, len]);
  });
  for (const [x0, y0, x1, y1] of rects) {
    for (const z of [0, len]) quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
  }
  return { pos, idx };
}

describe("wallThickness", () => {
  it("measures a bent angle's wall", () => {
    const { pos, idx } = prism([[0, 0], [19, 0], [19, 2], [2, 2], [2, 19], [0, 19]], [[0, 0, 19, 2], [0, 2, 2, 19]], 200);
    expect(wallThickness(pos, idx)).toBeCloseTo(2, 1);
  });

  it("measures a flat plate and ignores a block", () => {
    const plate = prism([[0, 0], [100, 0], [100, 3], [0, 3]], [[0, 0, 100, 3]], 150);
    expect(wallThickness(plate.pos, plate.idx)).toBeCloseTo(3, 1);
    const block = prism([[0, 0], [20, 0], [20, 30], [0, 30]], [[0, 0, 20, 30]], 40);
    expect(wallThickness(block.pos, block.idx)).toBeUndefined();
  });
});

describe("sizeOf", () => {
  it("gives sorted extents in mm from metres", () => {
    expect(sizeOf([0, 0, 0, 0.2, 0.003, 0.12, 0.1, 0.001, 0.05])).toEqual([3, 120, 200]);
  });
});
