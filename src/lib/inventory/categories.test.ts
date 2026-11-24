import { describe, expect, it } from "vitest";
import { categoryOf, sizeOrderProblem, type InvCategory } from "./categories";

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

// Harel, 2026-11-24: 50×20 and 20×50 are one size, written with the bigger side (X) first.
describe("sizeOrderProblem", () => {
  const tube: InvCategory = { ...cat("square-tubes", true), fields: [{ id: "size", label: "Size (mm)", kind: "text" }] };
  const block: InvCategory = { ...cat("blocks", true), fields: [{ id: "x", label: "X (mm)", kind: "number" }, { id: "y", label: "Y (mm)", kind: "number" }] };
  it("refuses Y bigger than X", () => {
    expect(sizeOrderProblem(tube, { size: "20x50" })).toContain("50×20");
    expect(sizeOrderProblem(block, { x: "20", y: "50" })).toContain("X 50, Y 20");
  });
  it("takes X ≥ Y, a missing side, and categories outside Raw Stock", () => {
    expect(sizeOrderProblem(tube, { size: "50x20" })).toBeNull();
    expect(sizeOrderProblem(tube, { size: "25x25x1.5" })).toBeNull();
    expect(sizeOrderProblem(block, { x: "20" })).toBeNull();
    expect(sizeOrderProblem({ ...tube, group: "cots" }, { size: "8x22" })).toBeNull();
  });
});
