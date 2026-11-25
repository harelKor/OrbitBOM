import { describe, expect, it } from "vitest";
import { keepFilled } from "./fill";

describe("keepFilled", () => {
  const row = { material: "Stainless Steel", process1: "laser", addedProcesses: [{ machine: "cnc", qa: false }], inventoryItemId: "i1", unitPrice: null, cotsLinks: [] };
  it("never empties a field that has a value (audit, 2026-11-20)", () => {
    expect(keepFilled(row, { classification: "cots", material: null, process1: null, process2: null, addedProcesses: [], inventoryItemId: null })).toEqual({ classification: "cots" });
  });
  it("drops the item link with a new material in its place (BOM-12)", () => {
    expect(keepFilled(row, { material: "PLA", inventoryItemId: null })).toEqual({ material: "PLA", inventoryItemId: null });
  });
  it("fills empty fields and changes filled ones", () => {
    expect(keepFilled(row, { material: "6061-T6", unitPrice: 3, cotsLinks: [{ url: "https://x.test/a" }] })).toEqual({ material: "6061-T6", unitPrice: 3, cotsLinks: [{ url: "https://x.test/a" }] });
  });
});
