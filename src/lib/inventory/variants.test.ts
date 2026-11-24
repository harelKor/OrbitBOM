import { describe, expect, it } from "vitest";
import { applyVariantOp, conditionsFor, countVariants, countingSum, scopeFits, stepVariants, variantMoves, variantsAllowed, type ItemVariant } from "./variants";

let n = 0;
const id = () => `v${++n}`;
const DEF = "defective";
const unc = new Set([DEF]);
const list = (): ItemVariant[] => [
  { id: "a", conditionId: "new", count: 3, note: null },
  { id: "b", conditionId: "worn", count: 2, note: null },
  { id: "c", conditionId: DEF, count: 4, note: null },
];

describe("variants", () => {
  it("counts only the variants whose condition counts", () => {
    expect(countingSum(list(), unc)).toBe(5);
  });

  it("steps the named variant, else the first counting one, and takes on past it", () => {
    expect(stepVariants(list(), 1, unc, "b", id).find((v) => v.id === "b")!.count).toBe(3);
    // A Defective variant is never stepped: the first counting one is.
    expect(stepVariants(list(), 1, unc, "c", id).find((v) => v.id === "a")!.count).toBe(4);
    const taken = stepVariants(list(), -4, unc, null, id);
    expect(taken.map((v) => v.count)).toEqual([0, 1, 4]);
    // Every variant Defective: a + starts one with no condition.
    const added = stepVariants([{ id: "c", conditionId: DEF, count: 1, note: null }], 2, unc, null, id);
    expect(added).toHaveLength(2);
    expect(countingSum(added, unc)).toBe(2);
  });

  it("sets a counted total on the first counting variant, or one named variant", () => {
    expect(countingSum(countVariants(list(), 8, unc, null, id), unc)).toBe(8);
    expect(countVariants(list(), 1, unc, "c", id).find((v) => v.id === "c")!.count).toBe(1);
  });

  it("turns today's stock into the first variant on the first add, and folds the last one back", () => {
    const first = applyVariantOp({ inStock: 6, conditionId: "new", variants: [] }, { add: { conditionId: "worn", count: 2 } }, id);
    expect(first.variants.map((v) => [v.conditionId, v.count])).toEqual([
      ["new", 6],
      ["worn", 2],
    ]);
    const last = applyVariantOp({ inStock: 6, conditionId: null, variants: [first.variants[0]] }, { remove: first.variants[0].id }, id);
    expect(last).toEqual({ variants: [], conditionId: "new" });
  });

  it("logs each counting change, and marking stock Defective as broke", () => {
    const before = list();
    const after = applyVariantOp({ inStock: 5, conditionId: null, variants: before }, { set: { id: "b", conditionId: DEF } }, id).variants;
    expect(variantMoves(before, after, unc)).toEqual([{ variantId: "b", delta: -2, broke: true }]);
    const removed = applyVariantOp({ inStock: 5, conditionId: null, variants: before }, { remove: "a" }, id).variants;
    expect(variantMoves(before, removed, unc)).toEqual([{ variantId: "a", delta: -3, broke: false }]);
  });

  it("offers conditions whose scope fits, and keeps the one an item has", () => {
    const conds = [
      { id: "new", onlyFor: null },
      { id: "printed", onlyFor: { categories: ["gears", "pulleys"] } },
      { id: DEF, onlyFor: { groups: ["electrical"], categories: ["computers-devices"] } },
    ];
    expect(conditionsFor(conds, { id: "gears", group: "cots" }).map((c) => c.id)).toEqual(["new", "printed"]);
    expect(conditionsFor(conds, { id: "motors", group: "electrical" }).map((c) => c.id)).toEqual(["new", DEF]);
    expect(conditionsFor(conds, { id: "bearings", group: "cots" }, ["printed"]).map((c) => c.id)).toEqual(["new", "printed"]);
    expect(scopeFits({ groups: [], categories: [] }, null)).toBe(true);
  });

  it("has no variants on Raw Stock", () => {
    expect(variantsAllowed({ group: "consumables" })).toBe(false);
    expect(variantsAllowed({ group: "cots", sheet: true })).toBe(false);
    expect(variantsAllowed({ group: "electrical" })).toBe(true);
  });
});
