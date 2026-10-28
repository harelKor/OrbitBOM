import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ db: {}, schema: {} }));
vi.mock("./history", () => ({ recordItemChanges: () => {} }));
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import { cleanBearing } from "./bearings";
import type { InvCategory } from "./categories";
import { keepPicks, matchesPicks, specGroups } from "./specFilters";

const cat = (id: string): InvCategory => {
  const c = DEFAULT_CATEGORIES.find((x) => x.id === id)!;
  return { id: c.id, label: c.label, noun: c.noun, group: c.group, sheet: !!c.sheet, image: null, defaultLocationId: null, fields: c.fields };
};
const bearings = cat("bearings");
const items: { specs: Record<string, string> }[] = [
  { specs: { bore: "8mm", od: "16mm", width: "5mm", flanged: "Radial" } },
  { specs: { bore: "8 mm", od: "19mm", width: "6mm", flanged: "Flanged" } },
  { specs: { bore: '1/2" Hex', flanged: "Flanged" } },
  { specs: { bore: "10mm", od: "26mm", width: "8mm", flanged: "Radial" } },
  { specs: { bore: "4mm", od: "12mm", width: "4mm", flanged: "Flanged" } },
];

describe("specGroups", () => {
  it("labels each field, lists each value once, inch first then metric ascending", () => {
    const g = specGroups(bearings, items, {});
    expect(g.map((x) => x.label)).toEqual(["Bore (ID)", "OD", "Width", "Type"]);
    expect(g[0].values.map((v) => v.label)).toEqual(['1/2" Hex', "4mm", "8mm", "10mm"]);
    expect(g[0].values.find((v) => v.label === "8mm")!.count).toBe(2);
  });
  it("narrows the other fields to what the pick leaves", () => {
    const g = specGroups(bearings, items, { bore: "8mm" });
    expect(g.find((x) => x.field.id === "od")!.values.map((v) => v.label)).toEqual(["16mm", "19mm"]);
    expect(g.find((x) => x.field.id === "bore")!.values.length).toBe(4);
    expect(items.filter((i) => matchesPicks(i, { bore: "8mm", flanged: "flanged" }))).toHaveLength(1);
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

describe("cleanBearing", () => {
  it("reads missing values from the name", () => {
    expect(cleanBearing("Bearing 10×16×5mm", { od: "16mm", bore: "10mm", width: "5mm" })).toEqual({ od: "16mm", bore: "10mm", width: "5mm", flanged: "Radial" });
    expect(cleanBearing("Bearing 3/4\" × 1 3/8\" × 0.43\" (odd)", {})).toEqual({ bore: '3/4" Round', od: '1 3/8"', width: '0.43"' });
    expect(cleanBearing('3/8" ThunderHex Flanged Bearing (10.25mm ID, 0.875" OD)', { id: "10.25mm", od: '0.875"', flanged: "Flanged" })).toEqual({
      bore: '3/8" ThunderHex',
      od: '0.875"',
      flanged: "Flanged",
    });
    expect(cleanBearing('Bearing 0.6" × 1.2" × 0.2"', { id: '0.6"', od: '1.2"', width: '0.2"' })).toEqual({ bore: '0.6" Round', od: '1.2"', width: '0.2"' });
    expect(cleanBearing('3/8" Hex Bearing', { bore: '3/8" Hex' })).toEqual({ bore: '3/8" Hex' });
  });
});
