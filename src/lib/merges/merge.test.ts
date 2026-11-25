import { expect, it } from "vitest";
import { fanOutChanges, mergedRow } from "./merge";
import { resolveCounterAdds } from "@/lib/parts/changes";

it("fans counters out by quantity and keeps the name on the merge", () => {
  const members = [
    { id: "a", quantity: 4 },
    { id: "b", quantity: 2 },
    { id: "c", quantity: 3 },
  ];
  expect(fanOutChanges(members, { doneProcess1: 7, note: "deburr" })).toEqual({
    perMember: [
      { id: "a", changes: { doneProcess1: 4, note: "deburr" } },
      { id: "b", changes: { doneProcess1: 2, note: "deburr" } },
      { id: "c", changes: { doneProcess1: 1, note: "deburr" } },
    ],
  });
  expect(fanOutChanges(members, { displayName: "Spacers" })).toEqual({ rename: "Spacers", perMember: [] });
  expect(fanOutChanges(members, { doneProcess1: 12 }).perMember.map((p) => p.changes.doneProcess1)).toEqual([4, 2, 6]);
});

it("builds the merged row", () => {
  const base = { partNumber: "P1", displayName: null, addedProcesses: [] };
  const row = mergedRow({ id: "m1", name: "Spacers" }, [
    { ...base, id: "a", quantity: 4, doneProcess1: 4 },
    { ...base, id: "b", quantity: 2, doneProcess1: 1 },
  ] as never[]);
  expect(row).toMatchObject({ id: "merge:m1", displayName: "Spacers", quantity: 6, doneProcess1: 5, memberIds: ["a", "b"] });
});

it("counts one piece on a merged row's added process once (BOM-5)", () => {
  const cnc = (done: number) => [{ machine: "cnc", done, qa: false, qaDone: false }];
  const members = [
    { partNumber: "P1", displayName: null, id: "a", quantity: 2, doneProcess1: 2, stockCount: 0, addedProcesses: cnc(1) },
    { partNumber: "P1", displayName: null, id: "b", quantity: 2, doneProcess1: 2, stockCount: 0, addedProcesses: cnc(0) },
    { partNumber: "P1", displayName: null, id: "c", quantity: 2, doneProcess1: 2, stockCount: 0, addedProcesses: cnc(0) },
  ] as never[];
  const row = mergedRow({ id: "m1", name: "Spacers" }, members);
  const resolved = resolveCounterAdds(row, { addAt: { process: 2, delta: 1 } });
  expect(resolved).toEqual({ addedDone: [2] });
  expect(fanOutChanges(members, resolved).perMember.map((p) => p.changes.addedDone)).toEqual([[2], [0], [0]]);
});
