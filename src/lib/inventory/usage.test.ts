import { expect, it } from "vitest";
import { allocateToParts, computeUsage, type UsagePart } from "./usage";

const part = (partId: string, robotId: string, quantity: number): UsagePart => ({
  partId,
  inventoryItemId: "bearing",
  quantity,
  robotId,
  robotName: robotId,
  systemName: "Drive",
  partName: partId,
});

it("allocates stock once per robot, again for each robot", () => {
  const usage = computeUsage(new Map([["bearing", 10]]), [part("a", "r1", 4), part("b", "r1", 8), part("c", "r2", 3)]);
  const u = usage.get("bearing")!;
  expect(u.robots).toEqual([
    { robotId: "r1", robotName: "r1", needed: 12, allocated: 10 },
    { robotId: "r2", robotName: "r2", needed: 3, allocated: 3 },
  ]);
  expect(u.used).toBe(10);
  expect(u.parts).toHaveLength(3);
});

it("fills parts in order", () => {
  expect([...allocateToParts(5, [{ partId: "a", quantity: 4 }, { partId: "b", quantity: 4 }])]).toEqual([
    ["a", 4],
    ["b", 1],
  ]);
});
