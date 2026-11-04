import { describe, expect, it } from "vitest";
import { applyCounters, applyStatus, computeStatus, isDone, partStatusLabel, type StatusInput } from "./status";
import { partTag } from "./partTag";
import { areaQueue, fabStage, factoryQueue, isAreaInStock } from "./fab";

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

describe("Factory Fab parts", () => {
  const zivudim: StatusInput = { ...base, process1: "zivudim", process2: null };
  it("read every old status as one of the five factory statuses", () => {
    expect(computeStatus({ ...zivudim, designState: "Released" })).toBe("Released");
    expect(computeStatus({ ...zivudim, designState: "Gcoded" })).toBe("Released");
    expect(computeStatus({ ...zivudim, designState: "In Process 1" })).toBe("In Factory");
    expect(computeStatus({ ...zivudim, designState: "Post Processing" })).toBe("In Factory");
    expect(computeStatus({ ...zivudim, designState: "In Spare Stock" })).toBe("In Stock");
    expect(computeStatus({ ...zivudim, doneProcess1: 1 })).toBe("In Factory");
    expect(computeStatus({ ...zivudim, doneProcess1: 2 })).toBe("Ready for QA");
  });

  it("leave Hadasa on the usual statuses, tagged In factory", () => {
    const hadasa = { ...base, process1: "hadasas", process2: null, designState: "Gcoded" };
    expect(computeStatus(hadasa)).toBe("Gcoded");
    expect(partTag(hadasa)).toBe("factory");
    expect(partTag({ ...base, process1: "3d-aran", process2: null })).toBe("factory");
  });

  it("leave To Fab", () => {
    expect(fabStage({ ...zivudim, designState: "Released" })).toBeNull();
    expect(fabStage({ ...base, process1: "hadasas", designState: "Released" })).toBe("ready");
    expect(factoryQueue({ ...zivudim, designState: "In Process 1" })).toBe("zivudim");
    expect(factoryQueue({ ...zivudim, designState: "In Stock" })).toBeNull();
    expect(isAreaInStock({ ...zivudim, designState: "In Stock" })).toBe(true);
  });
});

describe("3D Printing parts", () => {
  const bambu: StatusInput = { ...base, process1: "3d-bambu", process2: null };
  it("read every old status as one of the print statuses", () => {
    expect(computeStatus({ ...bambu, designState: "Gcoded" })).toBe("Gcoded");
    expect(partStatusLabel({ ...bambu, designState: "Gcoded" })).toBe("Sliced");
    expect(partStatusLabel({ ...bambu, designState: "In Process 1" })).toBe("Printing");
    expect(computeStatus({ ...bambu, designState: "Post Processing" })).toBe("Ready for QA");
    expect(computeStatus({ ...bambu, designState: "Secondary Production" })).toBe("Reproduction");
    expect(computeStatus({ ...bambu, designState: "Reproduction" })).toBe("Reproduction");
    expect(computeStatus({ ...base, process1: "3d-h2d", process2: null, designState: "In Process 1" })).toBe("In Process 1");
  });

  it("leave Shop Fab; ARAN stays a factory", () => {
    expect(fabStage({ ...bambu, designState: "Released" })).toBeNull();
    expect(areaQueue({ ...bambu, designState: "Reproduction" }, "print")).toBe("3d-bambu");
    expect(areaQueue({ ...base, process1: "3d-aran", process2: null, designState: "Released" }, "print")).toBeNull();
    expect(areaQueue({ ...base, process1: "3d-aran", process2: null, designState: "Released" }, "factory")).toBe("3d-aran");
  });
});
