import { describe, expect, it } from "vitest";
import { applyStatus, computeStatus, isDone, isMidQa, orderStatus, partStatusLabel, qaNext, statusMachine, type AddedProcess, type StatusInput } from "./status";
import { partTag } from "./partTag";
import { areaQueue, fabStage, factoryQueue, isAreaInStock, isFabFinished } from "./fab";

const proc = (machine: string, over: Partial<AddedProcess> = {}): AddedProcess => ({ machine, done: 0, qa: false, qaDone: false, ...over });

const base: StatusInput = {
  classification: "inhouse",
  quantity: 2,
  designState: null,
  process1: "cnc",
  doneProcess1: 0,
  addedProcesses: [proc("bending")],
  qaHeld: false,
  cotsQa: false,
};
const one: StatusInput = { ...base, addedProcesses: [] };

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

  it("derives from the first unfinished process once a counter moves", () => {
    expect(computeStatus({ ...base, designState: "Gcoded", doneProcess1: 1 })).toBe("In Process 1");
    expect(computeStatus({ ...base, doneProcess1: 2 })).toBe("Released P2+");
    expect(partStatusLabel({ ...base, doneProcess1: 2 })).toBe("Released P2");
    expect(computeStatus({ ...base, doneProcess1: 2, addedProcesses: [proc("bending", { done: 1 })] })).toBe("In Process 2+");
    expect(partStatusLabel({ ...base, doneProcess1: 2, addedProcesses: [proc("bending", { done: 1 })] })).toBe("In Process 2");
    expect(computeStatus({ ...base, doneProcess1: 2, addedProcesses: [proc("bending", { done: 2 })] })).toBe("Ready for QA");
  });

  it("with no added process goes straight to Ready for QA", () => {
    expect(computeStatus({ ...one, doneProcess1: 2 })).toBe("Ready for QA");
  });

  it("numbers every added process", () => {
    const three = { ...base, doneProcess1: 2, addedProcesses: [proc("bending", { done: 2 }), proc("laser")] };
    expect(partStatusLabel(three)).toBe("Released P3");
    expect(statusMachine(three)).toBe("laser");
  });

  it("reads dropped shop statuses (and Ready for Process 2) as their new ones", () => {
    expect(computeStatus({ ...base, designState: "Ordered" })).toBe("Released");
    expect(computeStatus({ ...base, designState: "Ready for Process 2" })).toBe("Released P2+");
    expect(statusMachine({ ...base, designState: "Released P2" })).toBe("bending");
  });

  it("ignores counters on COTS parts", () => {
    expect(computeStatus({ ...base, classification: "cots", designState: "Ordered", doneProcess1: 5 })).toBe("In Order List");
  });

  it("counts a part parked in a done status as done", () => {
    expect(isDone({ ...base, designState: "In Stock" })).toBe(true);
    expect(isDone({ ...base, designState: "Gcoded" })).toBe(false);
  });
});

describe("QA before a process (Harel, 2026-11-20)", () => {
  const qaFirst = { ...base, doneProcess1: 2, addedProcesses: [proc("bending", { qa: true })] };
  it("goes to Ready for QA first, which isn't done", () => {
    expect(computeStatus(qaFirst)).toBe("Ready for QA");
    expect(isMidQa(qaFirst)).toBe(true);
    expect(isDone(qaFirst)).toBe(false);
    expect(isFabFinished(qaFirst)).toBe(false);
    expect(fabStage(qaFirst)).toBe("inProcess");
    expect(qaNext(qaFirst)).toBe("Released P2");
  });
  it("releases the part to its next process once approved", () => {
    const approved = { ...qaFirst, addedProcesses: [proc("bending", { qa: true, qaDone: true })] };
    expect(partStatusLabel(approved)).toBe("Released P2");
    expect(isDone(approved)).toBe(false);
    // Back under Shop Fab's Released, out of its batch (Harel, 2026-11-20).
    expect(fabStage(approved)).toBe("ready");
    expect(fabStage({ ...base, doneProcess1: 2 })).toBe("inProcess");
  });
  it("the final Ready for QA is done", () => {
    const last = { ...base, doneProcess1: 2, addedProcesses: [proc("bending", { done: 2 })] };
    expect(isMidQa(last)).toBe(false);
    expect(isDone(last)).toBe(true);
    expect(qaNext(last)).toBe("In Stock");
  });
  it("keeps a part held at its process after Move to QA? No", () => {
    expect(computeStatus({ ...one, doneProcess1: 2, qaHeld: true })).toBe("In Process 1");
    expect(partStatusLabel({ ...qaFirst, qaHeld: true })).toBe("Machining");
  });
});

describe("status writes", () => {
  it("choosing a status resets the counters", () => {
    expect(applyStatus("Gcoded")).toEqual({ designState: "Gcoded", doneProcess1: 0, qaHeld: false });
    expect(() => applyStatus("Nope")).toThrow();
    expect(() => applyStatus("Released P2+")).toThrow();
  });
  it("a numbered status counts the processes before it", () => {
    const three = { ...base, addedProcesses: [proc("bending"), proc("laser")] };
    expect(applyStatus("Released P3", three)).toEqual({
      designState: "Released P3",
      doneProcess1: 2,
      addedProcesses: [proc("bending", { done: 2, qaDone: true }), proc("laser", { qaDone: true })],
      qaHeld: false,
    });
  });
  // Harel, 2026-11-26: a shop part's status picked at a later process keeps the earlier ones.
  describe("a shop part at Process 2 (laser → QA → CNC)", () => {
    const atCnc: StatusInput = { ...base, process1: "laser", doneProcess1: 2, addedProcesses: [proc("cnc", { done: 1, qa: true, qaDone: true })] };
    const after = (status: string, p = atCnc) => ({ ...p, ...applyStatus(status, p) }) as StatusInput;
    it("Post Processing and Gcoded stay at CNC with the laser's count and the QA", () => {
      for (const s of ["Post Processing", "Gcoded"]) {
        const p = after(s);
        expect(p).toMatchObject({ designState: s, doneProcess1: 2 });
        expect(p.addedProcesses[0].qaDone).toBe(true);
        expect(statusMachine(p)).toBe("cnc");
        expect(computeStatus(p)).toBe(s);
      }
    });
    it("Ready for QA at the last process is the final QA, every process made", () => {
      const p = after("Ready for QA");
      expect(p.doneProcess1).toBe(2);
      expect(p.addedProcesses[0]).toMatchObject({ done: 2, qaDone: true });
      expect(isMidQa(p)).toBe(false);
      expect(qaNext(p)).toBe("In Stock");
    });
    it("Ready for QA at the laser goes to the QA before CNC, not the final one", () => {
      const atLaser: StatusInput = { ...atCnc, doneProcess1: 1, addedProcesses: [proc("cnc", { qa: true })] };
      expect(isMidQa(after("Ready for QA", atLaser))).toBe(true);
    });
    it("a pick while waiting for QA doesn't approve the QA", () => {
      const waiting: StatusInput = { ...atCnc, addedProcesses: [proc("cnc", { qa: true })] };
      expect(after("Post Processing", waiting)).toMatchObject({ designState: "Post Processing", doneProcess1: 0 });
    });
    it("Reproduction still starts over from Process 1; a part with only Process 1 resets", () => {
      expect(applyStatus("Reproduction", atCnc)).toMatchObject({ designState: "Reproduction", doneProcess1: 0 });
      expect(applyStatus("Post Processing", { ...one, doneProcess1: 1 })).toEqual({ designState: "Post Processing", doneProcess1: 0, qaHeld: false });
    });
  });
});

describe("partStatusLabel", () => {
  it("names the status as the current machine calls it", () => {
    expect(partStatusLabel({ ...base, designState: "In Process 1" })).toBe("Machining");
    expect(partStatusLabel({ ...base, process1: "3d-bambu", designState: "In Process 1" })).toBe("Printing");
    expect(partStatusLabel({ ...base, designState: "Released" })).toBe("Released");
  });
});

describe("partTag", () => {
  it("tags factory processes In factory", () => {
    expect(partTag(base)).toBe("inhouse");
    expect(partTag({ ...base, addedProcesses: [proc("zivudim")] })).toBe("factory");
    expect(partTag({ ...base, classification: "cots", process1: "beth-el" })).toBe("cots");
  });
});

describe("Factory Fab parts", () => {
  const zivudim: StatusInput = { ...one, process1: "zivudim" };
  it("read every old status as one of the five factory statuses", () => {
    expect(computeStatus({ ...zivudim, designState: "Released" })).toBe("Released");
    expect(computeStatus({ ...zivudim, designState: "Gcoded" })).toBe("Released");
    expect(computeStatus({ ...zivudim, designState: "In Process 1" })).toBe("In Factory");
    expect(computeStatus({ ...zivudim, designState: "Post Processing" })).toBe("In Factory");
    expect(computeStatus({ ...zivudim, designState: "In Spare Stock" })).toBe("In Stock");
    expect(computeStatus({ ...zivudim, doneProcess1: 1 })).toBe("In Factory");
    expect(computeStatus({ ...zivudim, doneProcess1: 2 })).toBe("Ready for QA");
  });

  it("follow the machine of the process the part is at now", () => {
    const later = { ...base, process1: "laser", doneProcess1: 2, addedProcesses: [proc("zivudim")] };
    expect(computeStatus(later)).toBe("Released");
    expect(partStatusLabel(later)).toBe("Released P2");
    expect(factoryQueue(later)).toBe("zivudim");
    expect(factoryQueue({ ...later, doneProcess1: 0, designState: "Released" })).toBeNull();
    // The factory finishing its process sends the part on, not back to the start.
    const more = { ...later, addedProcesses: [proc("zivudim"), proc("bending")] };
    expect(computeStatus({ ...more, ...applyStatus("In Stock", more) })).toBe("Released P2+");
  });

  it("leave Hadasa on the usual statuses, tagged In factory", () => {
    const hadasa = { ...one, process1: "hadasas", designState: "Gcoded" };
    expect(computeStatus(hadasa)).toBe("Gcoded");
    expect(partTag(hadasa)).toBe("factory");
    expect(partTag({ ...one, process1: "3d-aran" })).toBe("factory");
  });

  it("leave To Fab", () => {
    expect(fabStage({ ...zivudim, designState: "Released" })).toBeNull();
    expect(fabStage({ ...one, process1: "hadasas", designState: "Released" })).toBe("ready");
    expect(factoryQueue({ ...zivudim, designState: "In Process 1" })).toBe("zivudim");
    expect(factoryQueue({ ...zivudim, designState: "In Stock" })).toBeNull();
    expect(isAreaInStock({ ...zivudim, designState: "In Stock" })).toBe(true);
  });
});

describe("3D Printing parts", () => {
  const bambu: StatusInput = { ...one, process1: "3d-bambu" };
  it("read every old status as one of the print statuses", () => {
    expect(computeStatus({ ...bambu, designState: "Gcoded" })).toBe("Gcoded");
    expect(partStatusLabel({ ...bambu, designState: "Gcoded" })).toBe("Sliced");
    expect(partStatusLabel({ ...bambu, designState: "In Process 1" })).toBe("Printing");
    expect(computeStatus({ ...bambu, designState: "Post Processing" })).toBe("Ready for QA");
    expect(computeStatus({ ...bambu, designState: "Secondary Production" })).toBe("Reproduction");
    expect(computeStatus({ ...bambu, designState: "Reproduction" })).toBe("Reproduction");
    expect(computeStatus({ ...one, process1: "3d-h2d", designState: "In Process 1" })).toBe("In Process 1");
  });

  it("leave Shop Fab; ARAN stays a factory", () => {
    expect(fabStage({ ...bambu, designState: "Released" })).toBeNull();
    expect(areaQueue({ ...bambu, designState: "Reproduction" }, "print")).toBe("3d-bambu");
    expect(areaQueue({ ...one, process1: "3d-aran", designState: "Released" }, "print")).toBeNull();
    expect(areaQueue({ ...one, process1: "3d-aran", designState: "Released" }, "factory")).toBe("3d-aran");
  });
});

describe("COTS as Process 1 (Harel, 2026-11-20)", () => {
  const bought: StatusInput = { ...base, process1: "cots", addedProcesses: [proc("cnc")] };
  it("shows its order status while being bought", () => {
    expect(computeStatus({ ...bought, designState: "In Order List" })).toBe("In Order List");
    expect(orderStatus({ ...bought, designState: "In Order List" })).toBe("In Order List");
    expect(fabStage({ ...bought, designState: "In Order List" })).toBeNull();
  });
  it("after it arrives: In Stock on the Order List, Ready for QA in the BOM, then its next process", () => {
    const arrived = { ...bought, doneProcess1: 2 };
    expect(computeStatus(arrived)).toBe("Ready for QA");
    expect(orderStatus(arrived)).toBe("In Stock");
    expect(isDone(arrived)).toBe(false);
    const approved = { ...arrived, addedProcesses: [proc("cnc", { qaDone: true })] };
    expect(partStatusLabel(approved)).toBe("Released P2");
    expect(fabStage(approved)).toBe("ready");
  });
  it("a bought COTS part waits for QA in the BOM", () => {
    const cots = { ...base, classification: "cots" as const, designState: "In Stock", cotsQa: true };
    expect(computeStatus(cots)).toBe("Ready for QA");
    expect(orderStatus(cots)).toBe("In Stock");
  });
});
