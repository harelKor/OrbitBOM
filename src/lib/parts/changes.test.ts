import { describe, expect, it } from "vitest";
import { partChangesSchema, planPartUpdate, type PartRow } from "./changes";

const part: PartRow = {
  displayName: null,
  partNumber: null,
  classification: "inhouse",
  description: null,
  material: "3mm 6061-T6",
  quantity: 2,
  process1: "cnc",
  addedProcesses: [] as { machine: string; done: number; qa: boolean; qaDone?: boolean }[],
  designState: "Gcoded",
  doneProcess1: 0,
  qaHeld: false,
  cotsQa: false,
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
  cotsDeliveryDate: null,
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
      // Recorded too, so undoing the edit gives the field back to Onshape's sync.
      { field: "overriddenFields", oldValue: [], newValue: ["material"] },
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

describe("added processes (Harel, 2026-11-20)", () => {
  const bend = { machine: "bending", done: 0, qa: true, qaDone: false };
  const two: PartRow = { ...part, designState: null, addedProcesses: [bend] };
  it("counts at an added process from the saved count", () => {
    const plan = planPartUpdate({ ...two, doneProcess1: 2 }, { addAt: { process: 2, delta: 1 } }, "ui");
    expect(plan.set.addedProcesses).toEqual([{ ...bend, done: 1 }]);
  });
  it("approves a mid-way QA into the next process", () => {
    const plan = planPartUpdate({ ...two, doneProcess1: 2 }, { qa: "approve" }, "ui");
    expect(plan.set.addedProcesses).toEqual([{ ...bend, qaDone: true }]);
    const back = planPartUpdate({ ...two, doneProcess1: 2, addedProcesses: [{ ...bend, qaDone: true }] }, { qa: "reopen" }, "ui");
    expect(back.set.addedProcesses).toEqual([bend]);
  });
  it("approves the final QA into In Stock", () => {
    expect(planPartUpdate({ ...part, designState: null, doneProcess1: 2 }, { qa: "approve" }, "ui").set.designState).toBe("In Stock");
  });
  it("fills the first added process from Onshape's Process 2, keeping the rest", () => {
    const three = { ...two, addedProcesses: [bend, { machine: "laser", done: 0, qa: false }] };
    expect(planPartUpdate(three, { process2: "cnc" }, "sync").set.addedProcesses).toEqual([{ ...bend, machine: "cnc" }, three.addedProcesses[1]]);
    expect(planPartUpdate(part, { process2: "cnc" }, "sync").set.addedProcesses).toEqual([{ machine: "cnc", done: 0, qa: false, qaDone: false }]);
  });
  it("skips a numbered status the part has no process for", () => {
    expect(planPartUpdate(part, { status: "Released P2" }, "ui").set.designState).toBeUndefined();
    expect(partChangesSchema.safeParse({ status: "Released P2+" }).success).toBe(false);
  });
  it("sends an arrived COTS part to QA, not one taken from the shelf", () => {
    const ordered: PartRow = { ...part, classification: "cots", designState: "In Route" };
    expect(planPartUpdate(ordered, { status: "In Stock" }, "ui").set.cotsQa).toBe(true);
    expect(planPartUpdate(ordered, { status: "In Stock", fromShelfPrompt: true }, "ui").set.cotsQa).toBeUndefined();
    expect(planPartUpdate({ ...ordered, cotsQa: true }, { qa: "approve" }, "ui").set.cotsQa).toBe(false);
  });
  it("a part bought as its Process 1 arrives into QA", () => {
    const bought: PartRow = { ...part, process1: "cots", designState: "In Route", addedProcesses: [{ machine: "cnc", done: 0, qa: false }] };
    const plan = planPartUpdate(bought, { status: "In Stock" }, "ui");
    expect(plan.set).toMatchObject({ designState: null, doneProcess1: 2 });
  });
});
