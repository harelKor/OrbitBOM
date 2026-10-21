import { describe, expect, it } from "vitest";
import { sizeOf, suggestSetup, type Learned, type SetupInput } from "./rules";

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
});

describe("sizeOf", () => {
  it("gives sorted extents in mm from metres", () => {
    expect(sizeOf([0, 0, 0, 0.2, 0.003, 0.12, 0.1, 0.001, 0.05])).toEqual([3, 120, 200]);
  });
});
