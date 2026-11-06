import { describe, expect, it } from "vitest";
import { sizeOf, suggestSetup as suggest, wallThickness, type SetupInput, type StockItem } from "./rules";

const part = (over: Partial<SetupInput> = {}): SetupInput => ({
  classification: "cots",
  material: null,
  preProcess: null,
  process1: null,
  process2: null,
  geometry: null,
  ...over,
});

// Raw Stock items as the live inventory names them.
const item = (name: string, category: string, specs: Record<string, string> = {}): StockItem => ({ id: name, name, category, specs });
const STOCK: StockItem[] = [
  item("Aluminum plate 5052 2mm", "aluminum-plates", { thickness: "2" }),
  item("Aluminum plate 6061 2mm", "aluminum-plates", { thickness: "2", material: "2mm 6061-T6" }),
  item("Aluminum plate 6061 3mm", "aluminum-plates", { thickness: "3", material: "3mm 6061-T6" }),
  item("Aluminum plate 6061 6.35mm", "aluminum-plates", { thickness: "6.35" }),
  item("Aluminum plate 6061 6.7mm", "aluminum-plates", { thickness: "6.7", material: "6.7mm 6061-T6" }),
  item("Polycarbonate 2mm", "polycarbonate", { thickness: "2" }),
  item("Polycarbonate 3mm", "polycarbonate", { thickness: "3" }),
  item("Bambu PLA – Black filament", "filament", { material: "PLA" }),
  item("Markforged Onyx filament", "filament", { material: "Onyx" }),
];
const suggestSetup = (p: SetupInput) => suggest(p, STOCK);

describe("suggestSetup", () => {
  it("maps a flat aluminum part to the plate of its thickness and the default process", () => {
    const s = suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [3.02, 120, 200] } }));
    expect(s?.changes).toEqual({ material: "Aluminum plate 6061 3mm", inventoryItemId: "Aluminum plate 6061 3mm", preProcess: null, process1: "cnc", process2: null, classification: "inhouse" });
    expect(s?.reason).toContain("3 mm thick");
  });

  it("tells 6.35 mm from 6.7 mm plates", () => {
    const s = suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [6.7, 50, 80] } }));
    expect(s?.changes.material).toBe("Aluminum plate 6061 6.7mm");
  });

  it("leaves a thick block or an unknown thickness alone", () => {
    expect(suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [20, 30, 40] } }))).toBeNull();
    expect(suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [7.3, 60, 90] } }))).toBeNull();
    expect(suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061" } }))).toBeNull();
  });

  it("uses the team default, not what other parts of the material got", () => {
    const s = suggestSetup(part({ geometry: { onshapeMaterial: "Polycarbonate", bbox: [3, 100, 100] } }));
    expect(s?.changes.process1).toBe("laser");
    expect(s?.reason).toContain("the team default");
  });

  it("recognises 3D printed parts by their Onshape material", () => {
    expect(suggestSetup(part({ geometry: { onshapeMaterial: "PLA" } }))?.changes).toMatchObject({ material: "PLA", process1: "3d-bambu" });
    expect(suggestSetup(part({ geometry: { onshapeMaterial: "Onyx" } }))?.changes).toMatchObject({ material: "Onyx", process1: "3d-markforged" });
    // A print linked to a filament item gets the plain material instead (Harel, 2026-11-01).
    expect(suggestSetup(part({ classification: "inhouse", material: "Bambu PLA – Black filament", inventoryItemId: "Bambu PLA – Black filament" }))?.changes).toMatchObject({
      material: "PLA",
      inventoryItemId: null,
    });
  });

  it("only adds processes to a part that has a material, and keeps processes someone set", () => {
    expect(suggestSetup(part({ classification: "inhouse", material: "Polycarbonate 2mm" }))?.changes).toEqual({
      inventoryItemId: "Polycarbonate 2mm",
      preProcess: null,
      process1: "laser",
      process2: null,
    });
    expect(suggestSetup(part({ material: "Polycarbonate 2mm", process1: "cnc" }))).toBeNull();
    expect(suggestSetup(part({ classification: "external", geometry: { onshapeMaterial: "PLA" } }))).toBeNull();
  });

  it("treats bent sheet as a plate of its wall thickness, then bending", () => {
    const s = suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [19, 19, 200], wallMm: 2.01, sheetMetal: { flatPartId: "JFD" } } }));
    expect(s?.changes).toMatchObject({ material: "Aluminum plate 6061 2mm", process1: "cnc", process2: "bending" });
    expect(s?.reason).toContain("bent sheet metal and 2 mm thick");
  });

  it("bends a thin-walled bracket, but not a tube, a bushing or a flat plate", () => {
    const bent = suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [30, 40, 60], wallMm: 2 } }));
    expect(bent?.changes).toMatchObject({ material: "Aluminum plate 6061 2mm", process1: "cnc", process2: "bending" });
    // A long square part with a thin wall is a box tube (Harel, 2026-11-06).
    const tube = suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [19, 19, 200], wallMm: 2 } }));
    expect(tube?.changes.process2 ?? null).toBeNull();
    // A small brass bushing with a measured wall isn't sheet.
    expect(suggestSetup(part({ classification: "inhouse", material: "Brass", geometry: { onshapeMaterial: "Brass", bbox: [13.7, 13.9, 18.9], wallMm: 2.8 } }))?.changes.process2 ?? null).toBeNull();
    const flat = suggestSetup(part({ geometry: { onshapeMaterial: "Aluminum - 6061", bbox: [2, 60, 200] } }));
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
