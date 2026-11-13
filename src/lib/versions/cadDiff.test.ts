import { describe, expect, it } from "vitest";
import { comparePlans, settleCandidates, sortChanges } from "./cadDiff";

const job = (key: string, path = `d/a/m/mv/e/${key}`) => ({ key, path, state: `st-${key}` });

describe("Update CAD's changes", () => {
  const old = {
    jobs: [job("f1"), job("f2")],
    placements: [
      { j: 0, k: "d:e1:A" },
      { j: 0, k: "d:e1:B" },
      { j: 1, k: "d:e2:C" },
      { j: 1, k: "d:e2:C" },
      { j: 1, k: "d:e2:D" },
    ],
    names: { "d:e1:A": "Plate", "d:e1:B": "Spacer", "d:e2:C": "Bolt", "d:e2:D": "Nut" },
  };
  const now = {
    // Part Studio e1 changed (new file); e2 didn't.
    jobs: [job("f1b"), job("f2")],
    placements: [
      { j: 0, k: "d:e1:A" },
      { j: 0, k: "d:e1:B" },
      { j: 1, k: "d:e2:C" },
      { j: 1, k: "d:e2:E" },
    ],
    names: { "d:e1:A": "Plate", "d:e1:B": "Spacer", "d:e2:C": "Bolt", "d:e2:E": "Washer" },
  };

  it("lists added, removed and count changes, and asks for shapes where a file changed", () => {
    const { changes, candidates } = comparePlans(old, now);
    expect(changes.map((c) => [c.name, c.change, c.count ?? null])).toEqual([
      ["Bolt", "modified", { from: 2, to: 1 }],
      ["Washer", "added", null],
      ["Nut", "removed", null],
    ]);
    expect(candidates.map((c) => [c.k, c.before.key, c.after.key])).toEqual([
      ["d:e1:A", "f1", "f1b"],
      ["d:e1:B", "f1", "f1b"],
    ]);
  });

  it("keeps a part whose shape is the same though its Part Studio changed", () => {
    const { changes, candidates } = comparePlans(old, now);
    const settled = settleCandidates(old, now, candidates, { before: { "d:e1:A": "s1", "d:e1:B": "s2" }, after: { "d:e1:A": "s1x", "d:e1:B": "s2" } });
    expect(settled.map((c) => [c.name, c.geometry, c.before?.file, c.after?.file])).toEqual([["Plate", true, "f1", "f1b"]]);
    expect(sortChanges([...changes, ...settled]).map((c) => c.name)).toEqual(["Bolt", "Plate", "Washer", "Nut"]);
  });

  it("shows a part it can't compare, marked as such", () => {
    const { candidates } = comparePlans(old, now);
    const settled = settleCandidates(old, now, candidates, { before: {}, after: { "d:e1:A": "s1", "d:e1:B": "s2" } });
    expect(settled.map((c) => c.note)).toEqual(["Shape not compared before", "Shape not compared before"]);
  });

  it("lists every part as added when the model was never built", () => {
    expect(comparePlans(null, now).changes.every((c) => c.change === "added")).toBe(true);
  });
});
