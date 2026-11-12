import { describe, expect, it } from "vitest";
import type { Recognized } from "./answer";
import { shelfMatches, type ShelfItem } from "./shelf";

const r = (over: Partial<Recognized>): Recognized => ({ categoryId: null, specs: {}, name: "", brand: null, partNumber: null, searchQuery: null, textSeen: "", confidence: 0.9, alternatives: [], toothed: false, ...over });
const item = (id: string, name: string, category: string, specs: Record<string, string> = {}, url?: string): ShelfItem => ({ id, name, category, specs, cotsLinks: url ? [{ url }] : [] });

const items = [
  item("kraken", "Kraken X60", "motors", {}, "https://wcproducts.com/products/kraken-x60"),
  item("kraken44", "Kraken X44", "motors"),
  item("g36hex", "36T 20 DP Gear", "gears", { teeth: "36", dp: "20 DP", bore: '1/2" Hex' }),
  item("g36spline", "36T 20 DP Gear", "gears", { teeth: "36", dp: "20 DP", bore: "SplineXS" }),
  item("g48", "48T 20 DP Gear", "gears", { teeth: "48", dp: "20 DP" }),
];

describe("shelfMatches", () => {
  it("finds the item linked to the product the stores found", () => {
    expect(shelfMatches(r({}), ["https://www.wcproducts.com/products/kraken-x60?variant=1"], items).map((i) => i.id)).toEqual(["kraken"]);
  });

  it("finds the item named like the product, the brand left out", () => {
    expect(shelfMatches(r({ name: "WCP Kraken X60", brand: "WCP", categoryId: "motors" }), [], items).map((i) => i.id)).toEqual(["kraken"]);
  });

  it("lists every gear with the fields the scan filled", () => {
    expect(shelfMatches(r({ categoryId: "gears", specs: { teeth: "36" } }), [], items).map((i) => i.id)).toEqual(["g36hex", "g36spline"]);
    expect(shelfMatches(r({ categoryId: "gears", specs: { teeth: "36", bore: "splinexs" } }), [], items).map((i) => i.id)).toEqual(["g36spline"]);
  });

  it("finds nothing for a new part, or from a generic name", () => {
    expect(shelfMatches(r({ categoryId: "gears", specs: { teeth: "60" } }), [], items)).toEqual([]);
    expect(shelfMatches(r({ name: "Gear" }), [], items)).toEqual([]);
  });
});
