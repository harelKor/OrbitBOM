import { expect, it } from "vitest";
import type { StatusInput } from "./status";
import { processBreakdown, statusBreakdown } from "./stats";

const part = (designState: string | null): StatusInput => ({
  classification: "inhouse",
  quantity: 1,
  designState,
  process1: null,
  addedProcesses: [] as { machine: string; done: number; qa: boolean; qaDone?: boolean }[],
  doneProcess1: 0,
  qaHeld: false,
  cotsQa: false,
});

it("counts parts per status and done parts", () => {
  const b = statusBreakdown([part(null), part("In Stock"), part("Ready for QA"), part("Gcoded")]);
  expect(b.total).toBe(4);
  expect(b.done).toBe(2);
  expect(b.percent).toBe(50);
  expect(b.statuses.find((s) => s.name === "Not Started")).toMatchObject({ count: 1, percent: 25 });
  expect(b.statuses).toHaveLength(18); // 14 made-part statuses and 4 COTS-only ones
});

it("handles an empty list", () => {
  expect(statusBreakdown([])).toMatchObject({ total: 0, done: 0, percent: 0 });
});

it("counts completion per machine", () => {
  const laser = { ...part(null), process1: "laser", quantity: 2 };
  const rows = processBreakdown([laser, { ...laser, doneProcess1: 2 }, { ...part("In Stock"), process1: "cnc" }]);
  expect(rows).toEqual([
    { id: "laser", name: "Laser", total: 2, done: 1, percent: 50 },
    { id: "cnc", name: "CNC", total: 1, done: 1, percent: 100 },
  ]);
});
