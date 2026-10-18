import { expect, it } from "vitest";
import { flattenTree, groupPath, subtreeIds } from "./groups";

const groups = [
  { id: "b", name: "Bearings", parentId: null },
  { id: "r", name: "Radial", parentId: "b" },
  { id: "x", name: "Tiny", parentId: "r" },
  { id: "g", name: "Gears", parentId: null },
];

it("walks the group tree", () => {
  expect(groupPath(groups, "x")).toBe("Bearings › Radial › Tiny");
  expect(groupPath(groups, null)).toBe("");
  expect([...subtreeIds(groups, "b")].sort()).toEqual(["b", "r", "x"]);
  expect(flattenTree(groups).map((n) => `${n.depth}${n.group.id}`)).toEqual(["0b", "1r", "2x", "0g"]);
});
