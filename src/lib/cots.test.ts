import { describe, expect, it } from "vitest";
import { cotsCategoryOf, groupSameCots, spreadCotsChanges } from "./cots";
import { computeStatus } from "./status";

const part = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  displayName: null,
  onshapeName: name,
  material: null,
  cotsCategory: null,
  sourceDid: null,
  sourceEid: null,
  onshapePartId: null,
  ...extra,
});

describe("COTS", () => {
  it("guesses the filter box from the name unless one is set", () => {
    expect(cotsCategoryOf(part("a", "WCP 18T HTD Pulley"))).toBe("motion");
    expect(cotsCategoryOf(part("a", "REV NEO Vortex"))).toBe("motors");
    expect(cotsCategoryOf(part("a", "1x1 Box Tube"))).toBe("square-tubes");
    expect(cotsCategoryOf(part("a", "Bracket", { cotsCategory: "wheels" }))).toBe("wheels");
    expect(cotsCategoryOf(part("a", "Thing"))).toBe("other");
  });

  it("groups the same part across systems by Onshape identity or name", () => {
    const same = { sourceDid: "d", sourceEid: "e", onshapePartId: "p" };
    const groups = groupSameCots([part("1", "Bearing", same), part("2", "Bearing "), part("3", "Other", same), part("4", "Wheel")]);
    expect(groups.map((g) => g.map((p) => p.id))).toEqual([["1", "2", "3"], ["4"]]);
  });

  it("spreads a grouped card's stock over its members and renames them all", () => {
    const members = [
      { id: "a", quantity: 2 },
      { id: "b", quantity: 3 },
    ];
    expect(spreadCotsChanges(members, { stockCount: 4, displayName: "Official" })).toEqual([
      { id: "a", changes: { stockCount: 2, displayName: "Official" } },
      { id: "b", changes: { stockCount: 2, displayName: "Official" } },
    ]);
  });

  it("gives COTS parts their own statuses", () => {
    const base = { quantity: 1, preProcess: null, process1: null, process2: null, donePreprocess: 0, doneProcess1: 0, doneProcess2: 0 };
    expect(computeStatus({ ...base, classification: "cots", designState: "In Route" })).toBe("In Route");
    expect(computeStatus({ ...base, classification: "cots", designState: "Gcoded" })).toBe("Not Started");
    expect(computeStatus({ ...base, classification: "inhouse", designState: "In Route" })).toBe("Not Started");
  });
});
