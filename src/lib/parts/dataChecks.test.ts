import { describe, expect, it } from "vitest";
import { collidingNumbers, cotsTypeProblem, numberOf } from "./dataChecks";

const raw = { ids: new Set(["item-plate"]), names: new Set(["3mm 6061-T6"]) };
const cots = { classification: "cots", material: null, inventoryItemId: null, process1: null, addedProcesses: [] };

describe("cotsTypeProblem", () => {
  it("flags a COTS part cut from raw stock or with a machine", () => {
    expect(cotsTypeProblem({ ...cots, material: "3mm 6061-T6" }, raw)).toMatch(/raw stock/);
    expect(cotsTypeProblem({ ...cots, inventoryItemId: "item-plate", material: "Plate" }, raw)).toMatch(/raw stock/);
    expect(cotsTypeProblem({ ...cots, process1: "cnc" }, raw)).toMatch(/made on/);
    expect(cotsTypeProblem({ ...cots, process1: "cots", addedProcesses: [{ machine: "laser" }] }, raw)).toMatch(/made on/);
  });
  it("leaves real COTS parts and In-house parts bought as their Process 1 alone", () => {
    expect(cotsTypeProblem({ ...cots, material: "Steel", process1: "cots" }, raw)).toBeNull();
    expect(cotsTypeProblem({ ...cots, classification: "inhouse", process1: "cots", addedProcesses: [{ machine: "cnc" }], material: "3mm 6061-T6" }, raw)).toBeNull();
  });
});

describe("collidingNumbers", () => {
  it("finds a part number on two different shapes", () => {
    const list = [
      { partNumber: null, onshapeName: "1690-26-421-01", sig: "a" },
      { partNumber: null, onshapeName: "1690-26-421-01", sig: "b" },
      { partNumber: null, onshapeName: "1690-26-421-02", sig: "c" },
      { partNumber: null, onshapeName: "1690-26-421-02", sig: "c" },
      { partNumber: null, onshapeName: "1690-26-421-03", sig: null },
      { partNumber: null, onshapeName: "1690-26-421-03", sig: "d" },
    ];
    expect([...collidingNumbers(list, numberOf, (p) => p.sig)]).toEqual(["1690-26-421-01"]);
  });
});
