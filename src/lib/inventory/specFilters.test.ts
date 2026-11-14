import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {}, schema: {} }));
vi.mock("./history", () => ({ recordItemChanges: () => {} }));
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import type { InvCategory } from "./categories";
import { keepPicks, matchesPicks, specGroups } from "./specFilters";

const cat = (id: string): InvCategory => {
  const c = DEFAULT_CATEGORIES.find((x) => x.id === id)!;
  return { id: c.id, label: c.label, noun: c.noun, group: c.group, sheet: !!c.sheet, image: null, defaultLocationId: null, fields: c.fields };
};
const bearings = cat("bearings");
const items: { specs: Record<string, string> }[] = [
  { specs: { bore: "8", od: "16", width: "5", flanged: "Radial" } },
  { specs: { bore: "8 ", od: "19", width: "6", flanged: "Flanged" } },
  { specs: { bore: '1/2" Hex', flanged: "Flanged" } },
  { specs: { bore: "10", od: "26", width: "8", flanged: "Radial" } },
  { specs: { bore: "4", od: "12", width: "4", flanged: "Flanged" } },
];

describe("specGroups", () => {
  it("labels each field, lists each value once, inch first then metric ascending", () => {
    const g = specGroups(bearings, items, {});
    expect(g.map((x) => x.label)).toEqual(["ID", "OD", "Thick", "Type"]);
    expect(g[0].values.map((v) => v.label)).toEqual(['1/2" Hex', "4", "8", "10"]);
    expect(g[0].values.find((v) => v.label === "8")!.count).toBe(2);
  });
  it("narrows the other fields to what the pick leaves", () => {
    const g = specGroups(bearings, items, { bore: "8" });
    expect(g.find((x) => x.field.id === "od")!.values.map((v) => v.label)).toEqual(["16", "19"]);
    expect(g.find((x) => x.field.id === "bore")!.values.length).toBe(4);
    expect(items.filter((i) => matchesPicks(i, { bore: "8", flanged: "flanged" }))).toHaveLength(1);
  });
  it("shows a sub-type's own fields only once that type is picked", () => {
    const tapes = cat("adhesives-tapes");
    const list: { specs: Record<string, string> }[] = [
      { specs: { type: "Glue", glue: "Epoxy" } },
      { specs: { type: "Glue", glue: "Hot Glue" } },
      { specs: { type: "Tape", tape: "Kapton" } },
    ];
    expect(specGroups(tapes, list, {}).map((x) => x.field.id)).toEqual(["type"]);
    expect(specGroups(tapes, list, { type: "glue" }).map((x) => x.field.id)).toEqual(["type", "glue"]);
    expect(keepPicks(tapes, { type: "tape", glue: "epoxy" })).toEqual({ type: "tape" });
  });
  it("adds the unit to bare numbers", () => {
    const g = specGroups(cat("pulleys"), [{ specs: { teeth: "36", width: "9" } }, { specs: { teeth: "18", width: "15" } }], {});
    expect(g.map((x) => [x.label, x.values.map((v) => v.label)])).toEqual([
      ["Teeth", ["18T", "36T"]],
      ["Width", ["9mm", "15mm"]],
    ]);
  });
});
