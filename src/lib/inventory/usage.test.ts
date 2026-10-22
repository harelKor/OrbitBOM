import { expect, it } from "vitest";
import { allocateToParts, computeUsage, type UsagePart } from "./usage";

const part = (partId: string, robotId: string, quantity: number, status?: string): UsagePart => ({
  partId,
  inventoryItemId: "bearing",
  quantity,
  robotId,
  robotName: robotId,
  systemName: "Drive",
  partName: partId,
  status,
});

it("shares one shelf between all robots", () => {
  const usage = computeUsage(new Map([["bearing", 10]]), [part("a", "r1", 4), part("b", "r1", 8), part("c", "r2", 3)]);
  const u = usage.get("bearing")!;
  expect(u.robots).toEqual([
    { robotId: "r1", robotName: "r1", needed: 12, allocated: 10 },
    { robotId: "r2", robotName: "r2", needed: 3, allocated: 0 },
  ]);
  expect(u).toMatchObject({ need: 15, covered: 10, short: 5, free: 0 });
  expect(u.parts).toHaveLength(3);
});

it("fills parts already In Stock first, then parts being ordered", () => {
  const u = computeUsage(new Map([["bearing", 5]]), [part("a", "r1", 4), part("b", "r2", 2, "In Route"), part("c", "r2", 2, "In Stock")]).get("bearing")!;
  expect([...u.coveredOf]).toEqual([
    ["c", 2],
    ["b", 2],
    ["a", 1],
  ]);
});

it("counts the stock left over as free", () => {
  expect(computeUsage(new Map([["bearing", 9]]), [part("a", "r1", 4)]).get("bearing")).toMatchObject({ need: 4, covered: 4, short: 0, free: 5 });
});

it("gives sheet items no need", () => {
  const u = computeUsage(new Map([["bearing", 1.5]]), [part("a", "r1", 4)], new Set(["bearing"])).get("bearing")!;
  expect(u).toMatchObject({ need: 0, covered: 0, short: 0 });
  expect(u.parts).toHaveLength(1);
});

it("fills parts in order", () => {
  expect([...allocateToParts(5, [{ partId: "a", quantity: 4 }, { partId: "b", quantity: 4 }])]).toEqual([
    ["a", 4],
    ["b", 1],
  ]);
});
