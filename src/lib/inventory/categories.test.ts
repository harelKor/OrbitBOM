import { describe, expect, it } from "vitest";
import { categoryOf, rawSizeProblem, type InvCategory } from "./categories";

const cat = (id: string, sheet = false): InvCategory => ({ id, label: id, noun: id, group: "consumables", sheet, image: null, defaultLocationId: null, fields: [] });

describe("categoryOf", () => {
  it("keeps a known category", () => {
    expect(categoryOf({ category: "plates", name: "608 Bearing" }, [cat("plates", true), cat("other")])).toBe("plates");
  });

  it("falls back to Other", () => {
    expect(categoryOf({ category: null, name: "Mystery thing" }, [cat("plates", true), cat("other")])).toBe("other");
    expect(categoryOf({ category: "gone", name: "Mystery thing" }, [cat("plates", true), cat("other")])).toBe("other");
  });

  it("never falls back to a sheet category", () => {
    expect(categoryOf({ category: null, name: "Mystery thing" }, [cat("tools"), cat("plates", true)])).toBe("tools");
    // Only sheet categories: an id no category has, which pages treat as a plain item.
    expect(categoryOf({ category: null, name: "Mystery thing" }, [cat("cylinders-blocks", true)])).toBe("other");
  });
});

// Harel, 2026-11-24: X, Y and the wall are filled in, and 50×20 and 20×50 are one size, written
// with the bigger side (X) first.
describe("rawSizeProblem", () => {
  const tube: InvCategory = {
    ...cat("square-tubes", true),
    fields: [
      { id: "size", label: "Size (mm)", kind: "text" },
      { id: "wall", label: "Wall (mm)", kind: "text" },
      { id: "length", label: "Length (mm)", kind: "number" },
    ],
  };
  const blocks: InvCategory = {
    ...cat("cylinders-blocks", true),
    fields: [
      { id: "shape", label: "Shape", kind: "options", options: ["Cylinder", "Block"] },
      { id: "x", label: "X (mm)", kind: "number", when: "Block" },
      { id: "y", label: "Y (mm)", kind: "number", when: "Block" },
    ],
  };
  it("needs X, Y and the wall", () => {
    expect(rawSizeProblem(tube, {})).toContain("Size (mm) as X×Y");
    expect(rawSizeProblem(tube, { size: "50", wall: "2" })).toContain("Size (mm)");
    expect(rawSizeProblem(tube, { size: "50x20" })).toContain("Wall (mm)");
    expect(rawSizeProblem(blocks, { shape: "Block", x: "20" })).toContain("Y (mm)");
  });
  it("refuses Y bigger than X", () => {
    expect(rawSizeProblem(tube, { size: "20x50", wall: "2" })).toContain("50×20");
    expect(rawSizeProblem(blocks, { shape: "Block", x: "20", y: "50" })).toContain("X 50, Y 20");
  });
  it("takes a full size, no length, a sub-type without X / Y, and categories outside Raw Stock", () => {
    expect(rawSizeProblem(tube, { size: "50x20", wall: "2" })).toBeNull();
    expect(rawSizeProblem(tube, { size: "25x25x1.5", wall: "1.5" })).toBeNull();
    expect(rawSizeProblem(blocks, { shape: "Cylinder" })).toBeNull();
    expect(rawSizeProblem({ ...tube, group: "cots" }, { size: "8x22" })).toBeNull();
  });
});

it("finds X / Y and wall fields by their labels too", () => {
  const custom: InvCategory = { ...cat("bars", true), fields: [{ id: "bx", label: "X (mm)", kind: "number" }, { id: "by", label: "Y (mm)", kind: "number" }, { id: "w", label: "Wall thickness", kind: "text" }] };
  expect(rawSizeProblem(custom, { bx: "40" })).toBe("Fill in Y (mm) and Wall thickness: a Raw Stock item needs its X, Y and wall.");
  expect(rawSizeProblem(custom, { bx: "40", by: "20", w: "2" })).toBeNull();
  expect(rawSizeProblem({ ...custom, fields: [{ id: "xl", label: "XL size", kind: "options", options: ["a"] }] }, {})).toBeNull();
});

it("reads Settings' Size X / Size Y text fields as X and Y, not as an X×Y size", () => {
  const box: InvCategory = { ...cat("bars", true), fields: [{ id: "field-2", label: "Size X", kind: "text" }, { id: "field-3", label: "Size Y", kind: "text" }, { id: "wall", label: "Wall", kind: "text" }] };
  expect(rawSizeProblem(box, { "field-2": "40", "field-3": "20", wall: "2" })).toBeNull();
  expect(rawSizeProblem(box, { "field-2": "20", "field-3": "40", wall: "2" })).toContain("X 40, Y 20");
  expect(rawSizeProblem(box, { "field-2": "40", wall: "2" })).toContain("Fill in Size Y");
});
