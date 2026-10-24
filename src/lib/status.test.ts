import { describe, expect, it } from "vitest";
import { applyCounters, applyStatus, computeStatus, isDone, partStatusLabel, type StatusInput } from "./status";
import { partTag } from "./partTag";

const base: StatusInput = {
  classification: "inhouse",
  quantity: 2,
  designState: null,
  preProcess: null,
  process1: "cnc",
  process2: "bending",
  donePreprocess: 0,
  doneProcess1: 0,
  doneProcess2: 0,
};

describe("computeStatus", () => {
  it("starts as Not Started", () => {
    expect(computeStatus(base)).toBe("Not Started");
  });

  it("shows the stored design state while no counter moved", () => {
    expect(computeStatus({ ...base, designState: "Gcoded" })).toBe("Gcoded");
  });

  it("falls back to Not Started for an unknown stored status", () => {
    expect(computeStatus({ ...base, designState: "Quote" })).toBe("Not Started");
  });

  it("derives from the first unfinished slot once a counter moves", () => {
    expect(computeStatus({ ...base, designState: "Gcoded", doneProcess1: 1 })).toBe("In Process 1");
    expect(computeStatus({ ...base, doneProcess1: 2 })).toBe("Ready for Process 2");
    expect(computeStatus({ ...base, doneProcess1: 2, doneProcess2: 1 })).toBe("Ready for Process 2");
    expect(computeStatus({ ...base, doneProcess1: 2, doneProcess2: 2 })).toBe("Ready for QA");
  });

  it("skips slots with no machine", () => {
    expect(computeStatus({ ...base, process2: null, doneProcess1: 2 })).toBe("Ready for QA");
  });

  it("puts an unfinished pre-process first", () => {
    expect(computeStatus({ ...base, preProcess: "laser", doneProcess1: 1 })).toBe("In Process 1");
  });

  it("reads dropped shop statuses as Released", () => {
    expect(computeStatus({ ...base, designState: "Ordered" })).toBe("Released");
    expect(computeStatus({ ...base, designState: "Build In Queue" })).toBe("Released");
  });

  it("ignores counters on COTS parts", () => {
    expect(
      computeStatus({ ...base, classification: "cots", designState: "Ordered", doneProcess1: 5 }),
    ).toBe("In Order List");
  });

  it("counts a part parked in a done status as done", () => {
    expect(isDone({ ...base, designState: "In Stock" })).toBe(true);
    expect(isDone({ ...base, designState: "Gcoded" })).toBe(false);
  });
});

describe("status writes", () => {
  it("choosing a status resets the counters", () => {
    expect(applyStatus("Gcoded")).toEqual({
      designState: "Gcoded",
      donePreprocess: 0,
      doneProcess1: 0,
      doneProcess2: 0,
    });
    expect(() => applyStatus("Nope")).toThrow();
  });

  it("moving a counter clears the design state", () => {
    expect(applyCounters({ doneProcess1: 1 })).toEqual({ doneProcess1: 1, designState: null });
    expect(applyCounters({ doneProcess1: 0 })).toEqual({ doneProcess1: 0 });
  });
});

describe("partStatusLabel", () => {
  it("names the status as the current machine calls it", () => {
    expect(partStatusLabel({ ...base, designState: "In Process 1" })).toBe("Machining");
    expect(partStatusLabel({ ...base, process1: "3d-bambu", designState: "In Process 1" })).toBe("Printing");
    // CNC done, now at bending.
    expect(partStatusLabel({ ...base, doneProcess1: 2, doneProcess2: 1 })).toBe("Ready for Process 2");
    expect(partStatusLabel({ ...base, designState: "Released" })).toBe("Released");
  });
});

describe("partTag", () => {
  it("tags factory processes In factory", () => {
    expect(partTag(base)).toBe("inhouse");
    expect(partTag({ ...base, process2: "zivudim" })).toBe("factory");
    expect(partTag({ ...base, classification: "cots", process1: "beth-el" })).toBe("cots");
  });
});
