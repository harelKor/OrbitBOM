import { expect, it } from "vitest";
import type { StatusInput } from "./status";
import { processBreakdown, statusBreakdown } from "./stats";

const part = (designState: string | null): StatusInput => ({
  classification: "inhouse",
  quantity: 1,
  designState,
  preProcess: null,
  process1: null,
  process2: null,
  donePreprocess: 0,
  doneProcess1: 0,
  doneProcess2: 0,
});

it("counts parts per status and done parts", () => {
  const b = statusBreakdown([part(null), part("In Stock"), part("Ready for QA"), part("Gcoded")]);
  expect(b.total).toBe(4);
  expect(b.done).toBe(2);
  expect(b.percent).toBe(50);
  expect(b.statuses.find((s) => s.name === "Not Started")).toMatchObject({ count: 1, percent: 25 });
  expect(b.statuses).toHaveLength(17); // 13 made-part statuses and 4 COTS-only ones
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
