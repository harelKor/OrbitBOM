import { describe, expect, it } from "vitest";
import { fabBatchProblems, fabBatchRefusal, fabCounts } from "./fab";

const part = {
  classification: "inhouse" as const,
  quantity: 4,
  designState: null as string | null,
  process1: "cnc",
  addedProcesses: [] as { machine: string; done: number; qa: boolean; qaDone?: boolean }[],
  doneProcess1: 0,
  qaHeld: false,
  cotsQa: false,
};

describe("fabCounts", () => {
  it("counts one more at the machine being worked on", () => {
    const c = fabCounts({ ...part, doneProcess1: 2 });
    expect(c.made).toBe(2);
    expect(c.addOne).toEqual({ add: { doneProcess1: 1 } });
    expect(c.takeBack).toEqual({ add: { doneProcess1: -1 } });
  });

  // Set to a done status from a menu: the counters are 0 but every piece is made.
  it("treats a finished part with nothing counted as fully made", () => {
    const c = fabCounts({ ...part, designState: "Ready for QA" });
    expect(c.finished).toBe(true);
    expect(c.made).toBe(4);
    expect(c.addOne).toBeNull();
    expect(c.takeBack).toEqual({ doneProcess1: 3 });
  });

  it("keeps earlier machines full when taking one back from a finished part", () => {
    const c = fabCounts({ ...part, addedProcesses: [{ machine: "bending", done: 0, qa: false }], designState: "In Stock" });
    expect(c.takeBack).toEqual({ doneProcess1: 4, addedDone: [3] });
  });

  it("sends a single finished piece back to In process", () => {
    expect(fabCounts({ ...part, quantity: 1, designState: "Ready for QA" }).takeBack).toEqual({ status: "In Process 1" });
    expect(fabCounts({ ...part, doneProcess1: 1, designState: null }).takeBack).toEqual({ status: "Released" });
  });

  // Audit 2026-11-25, BOM-1: no "+" at a process that waits for CAD's QA, held or not.
  it("offers no + while the next process waits for QA", () => {
    const cnc = { machine: "laser", done: 0, qa: true, qaDone: false };
    const waiting = { ...part, doneProcess1: 4, addedProcesses: [cnc] };
    for (const p of [waiting, { ...waiting, qaHeld: true }]) {
      const c = fabCounts(p);
      expect(c.gate).toBe(2);
      expect(c.addOne).toBeNull();
      expect(c.takeBack).toEqual({ add: { doneProcess1: -1 } });
    }
    const approved = fabCounts({ ...waiting, addedProcesses: [{ ...cnc, qaDone: true }] });
    expect(approved.gate).toBeNull();
    expect(approved.addOne).toEqual({ addAt: { process: 2, delta: 1 } });
  });
});

describe("fabBatchRefusal", () => {
  const cnc = { id: "cnc", name: "CNC" };
  const plate = (material: string | null, process1 = "cnc", more: Partial<typeof part> = {}) => ({ ...part, process1, material, displayName: "Plate", ...more });
  it("takes parts of one stock at the machine", () => {
    expect(fabBatchRefusal(cnc, [plate("3mm 6061"), plate("3mm 6061")])).toBeNull();
  });
  it("refuses a part at another machine now, even one that goes through it later", () => {
    expect(fabBatchRefusal(cnc, [plate("3mm 6061"), plate("3mm 6061", "laser")])).toMatch(/is at .* now, not CNC/);
    expect(fabBatchRefusal(cnc, [plate("3mm 6061", "laser", { addedProcesses: [{ machine: "cnc", done: 0, qa: false }] })])).toMatch(/now, not CNC/);
  });
  it("refuses a part with no material and a second stock", () => {
    expect(fabBatchRefusal(cnc, [plate(null)])).toBe("Plate has no material: give it one before it goes into a batch.");
    expect(fabBatchRefusal(cnc, [plate("3mm 6061"), plate("5mm 6061")])).toMatch(/one stock/);
    expect(fabBatchRefusal(cnc, [plate("3mm 6061")], [plate("Delrin")])).toMatch(/one stock/);
  });
  it("lets a factory pack mix materials", () => {
    expect(fabBatchRefusal({ id: "zivudim", name: "Zivudim" }, [plate("6061", "zivudim"), plate("Delrin", "zivudim"), plate(null, "zivudim")])).toBeNull();
  });
});

describe("fabBatchProblems", () => {
  const plate = (material: string | null, process1 = "cnc", more: Partial<typeof part> = {}) => ({ ...part, process1, material, ...more });
  it("flags no material, mixed stock and parts not at the batch's machine", () => {
    expect(fabBatchProblems("cnc", [plate(null), plate(null)])).toEqual(["No material"]);
    expect(fabBatchProblems("cnc", [plate("3mm 6061"), plate("Box tube")])).toEqual(["Mixed stock: 3mm 6061, Box tube"]);
    expect(fabBatchProblems("cnc", [plate("Box tube"), plate("Box tube", "laser")])).toEqual(["1 part isn't at CNC"]);
  });
  it("leaves a part that moved on to its next process alone", () => {
    const moved = plate("3mm 6061", "cnc", { doneProcess1: 4, addedProcesses: [{ machine: "laser", done: 0, qa: false }] });
    expect(fabBatchProblems("cnc", [moved])).toEqual([]);
  });
});
