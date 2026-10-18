import { expect, it } from "vitest";
import { fanOutChanges, mergedRow } from "./merge";

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
  const base = { partNumber: "P1", displayName: null, donePreprocess: 0, doneProcess2: 0 };
  const row = mergedRow({ id: "m1", name: "Spacers" }, [
    { ...base, id: "a", quantity: 4, doneProcess1: 4 },
    { ...base, id: "b", quantity: 2, doneProcess1: 1 },
  ] as never[]);
  expect(row).toMatchObject({ id: "merge:m1", displayName: "Spacers", quantity: 6, doneProcess1: 5, memberIds: ["a", "b"] });
});
