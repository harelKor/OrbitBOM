import { describe, expect, it } from "vitest";
import { fabBatchRefusal, fabCounts } from "./fab";

const part = {
  classification: "inhouse" as const,
  quantity: 4,
  designState: null as string | null,
  preProcess: null as string | null,
  process1: "cnc",
  process2: null as string | null,
  donePreprocess: 0,
  doneProcess1: 0,
  doneProcess2: 0,
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
    expect(c.takeBack).toEqual({ counters: { doneProcess1: 3 } });
  });

  it("keeps earlier machines full when taking one back from a finished part", () => {
    const c = fabCounts({ ...part, preProcess: "laser", designState: "In Stock" });
    expect(c.takeBack).toEqual({ counters: { donePreprocess: 4, doneProcess1: 3 } });
  });

  it("sends a single finished piece back to In process", () => {
    expect(fabCounts({ ...part, quantity: 1, designState: "Ready for QA" }).takeBack).toEqual({ status: "In Process 1" });
    expect(fabCounts({ ...part, doneProcess1: 1, designState: null }).takeBack).toEqual({ status: "Released" });
  });
});

describe("fabBatchRefusal", () => {
  const cnc = { id: "cnc", name: "CNC" };
  const plate = (material: string | null, process1 = "cnc") => ({ preProcess: null, process1, process2: null, material });
  it("takes parts of one material that all go through the machine", () => {
    expect(fabBatchRefusal(cnc, [plate("6061"), plate("6061")])).toBeNull();
  });
  it("refuses a part that skips the machine or a second material", () => {
    expect(fabBatchRefusal(cnc, [plate("6061"), plate("6061", "laser")])).toBe("Every part in the fab must go through CNC.");
    expect(fabBatchRefusal(cnc, [plate("6061"), plate("Delrin")])).toBe("A fab can only hold parts of one material.");
  });
  it("lets a factory pack mix materials", () => {
    expect(fabBatchRefusal({ id: "zivudim", name: "Zivudim" }, [plate("6061", "zivudim"), plate("Delrin", "zivudim")])).toBeNull();
  });
});
