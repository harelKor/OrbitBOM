import { describe, expect, it } from "vitest";
import { partChangesSchema, planPartUpdate, type PartRow } from "./changes";

const part: PartRow = {
  displayName: null,
  partNumber: null,
  classification: "inhouse",
  description: null,
  material: "3mm 6061-T6",
  quantity: 2,
  preProcess: null,
  process1: "cnc",
  process2: null,
  designState: "Gcoded",
  donePreprocess: 0,
  doneProcess1: 0,
  doneProcess2: 0,
  priority: "normal",
  deadline: null,
  designerName: null,
  fabricators: {},
  note: null,
  estMinutes: null,
  actualMinutes: null,
  drawingUrl: null,
  inventoryItemId: null,
  cotsLinks: [],
  unitPrice: null,
  cotsCategory: null,
  stockCount: 0,
  postDone: 0,
  cotsSentBack: null,
  overriddenFields: [],
};

describe("planPartUpdate", () => {
  it("skips unchanged fields", () => {
    expect(planPartUpdate(part, { material: "3mm 6061-T6", priority: "normal" }, "ui")).toEqual({
      set: {},
      history: [],
    });
  });

  it("marks Onshape fields as overridden when edited in the app", () => {
    const plan = planPartUpdate(part, { material: "2mm 6061-T6", note: "deburr" }, "ui");
    expect(plan.set).toEqual({
      material: "2mm 6061-T6",
      note: "deburr",
      overriddenFields: ["material"],
    });
    expect(plan.history).toEqual([
      { field: "material", oldValue: "3mm 6061-T6", newValue: "2mm 6061-T6" },
      { field: "note", oldValue: null, newValue: "deburr" },
    ]);
  });

  it("doesn't mark overrides for sync writes", () => {
    expect(planPartUpdate(part, { material: "2mm 6061-T6" }, "sync").set).toEqual({
      material: "2mm 6061-T6",
    });
  });

  it("keeps the post-processed count only through Post Processing and the done statuses", () => {
    const counted = { ...part, postDone: 2 };
    expect(planPartUpdate(counted, { status: "Ready for QA" }, "ui").set.postDone).toBeUndefined();
    expect(planPartUpdate(counted, { status: "Post Processing" }, "ui").set.postDone).toBeUndefined();
    expect(planPartUpdate(counted, { status: "Released" }, "ui").set.postDone).toBe(0);
    expect(planPartUpdate(counted, { status: "Ready for QA", postDone: 3 }, "ui").set.postDone).toBe(3);
  });

  it("resets counters when a status is chosen", () => {
    const plan = planPartUpdate({ ...part, doneProcess1: 1, designState: null }, { status: "In Stock" }, "ui");
    expect(plan.set).toEqual({ designState: "In Stock", doneProcess1: 0 });
  });

  it("clears the stored status when a counter moves", () => {
    expect(planPartUpdate(part, { doneProcess1: 1 }, "ui").set).toEqual({
      doneProcess1: 1,
      designState: null,
    });
  });

  it("makes a COTS part In-house when it gets a machine", () => {
    const cots = { ...part, classification: "cots" as const };
    expect(planPartUpdate(cots, { process1: "cnc" }, "ui").set.classification).toBe("inhouse");
    expect(planPartUpdate(cots, { process1: null }, "ui").set.classification).toBeUndefined();
    expect(planPartUpdate(cots, { process1: "cnc" }, "sync").set.classification).toBeUndefined();
  });

  it("merges fabricators by slot", () => {
    const plan = planPartUpdate({ ...part, fabricators: { process1: "Noa" } }, { fabricators: { process2: "Ido" } }, "ui");
    expect(plan.set.fabricators).toEqual({ process1: "Noa", process2: "Ido" });
  });
});

describe("counter steps", () => {
  it("counts from the saved part, not the page's copy", () => {
    // Two phones both saw 0 made and pressed +: each step lands on what is saved by then.
    const first = planPartUpdate(part, { add: { doneProcess1: 1 } }, "ui");
    expect(first.set).toMatchObject({ doneProcess1: 1, designState: null });
    const second = planPartUpdate({ ...part, ...first.set }, { add: { doneProcess1: 1 } }, "ui");
    expect(second.set).toEqual({ doneProcess1: 2 });
  });

  it("stays between 0 and the quantity", () => {
    expect(planPartUpdate({ ...part, designState: null, doneProcess1: 2 }, { add: { doneProcess1: 1 } }, "ui").history).toEqual([]);
    expect(planPartUpdate(part, { add: { postDone: -1 } }, "ui").history).toEqual([]);
    expect(planPartUpdate({ ...part, postDone: 1 }, { add: { postDone: 1 } }, "ui").set).toEqual({ postDone: 2 });
  });
});

describe("partChangesSchema", () => {
  it("rejects unknown machines and statuses", () => {
    expect(partChangesSchema.safeParse({ process1: "plasma" }).success).toBe(false);
    expect(partChangesSchema.safeParse({ status: "Done" }).success).toBe(false);
  });

  it("turns empty text into null", () => {
    expect(partChangesSchema.parse({ note: "  " })).toEqual({ note: null });
  });
});
