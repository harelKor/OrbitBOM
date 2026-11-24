import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import { copyListText, cotsCategoryOf, groupSameCots, orderAmount, orderTitle, sameItemForMerge, spreadCotsChanges, stockSize, withStockSize } from "./cots";
import { computeStatus } from "./status";

const IDS = DEFAULT_CATEGORIES.map((c) => c.id);

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
    expect(cotsCategoryOf(part("a", "WCP 18T HTD Pulley"), IDS)).toBe("pulleys");
    expect(cotsCategoryOf(part("a", "REV NEO Vortex"), IDS)).toBe("motors");
    expect(cotsCategoryOf(part("a", "1x1 Box Tube"), IDS)).toBe("square-tubes");
    expect(cotsCategoryOf(part("a", "Bracket", { cotsCategory: "wheels" }), IDS)).toBe("wheels");
    expect(cotsCategoryOf(part("a", "Bracket", { cotsCategory: "wheels" }), IDS, "gears")).toBe("gears");
    expect(cotsCategoryOf(part("a", "Bracket", { cotsCategory: "motion" }), IDS)).toBe("other");
    expect(cotsCategoryOf(part("a", "Thing"), IDS)).toBe("other");
  });

  // Harel, 2026-11-20: tubes cut to several lengths, merged on Released and ordered as one.
  it("keeps parts merged on Released as one order line", () => {
    const groups = groupSameCots([part("1", "Tube 120mm", { orderMerge: "m" }), part("2", "Tube 340mm", { orderMerge: "m" }), part("3", "Tube 500mm")]);
    expect(groups.map((g) => g.map((p) => p.id))).toEqual([["1", "2"], ["3"]]);
  });

  it("names an order line by its own name, else its item, else the part", () => {
    const tube = { displayName: "Tube 120mm", onshapeName: null };
    expect(orderTitle({ ...tube, orderName: "1x1 tube, 6 m" })).toBe("1x1 tube, 6 m");
    expect(orderTitle({ ...tube, shelf: { itemName: "1x1 box tube" } })).toBe("1x1 box tube");
    expect(orderTitle(tube)).toBe("Tube 120mm");
  });

  it("merges only parts of one inventory item", () => {
    expect(sameItemForMerge([{ inventoryItemId: "a" }, { inventoryItemId: "a" }, { inventoryItemId: null }])).toBe(true);
    expect(sameItemForMerge([{ inventoryItemId: "a" }, { inventoryItemId: "b" }])).toBe(false);
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
    const base = { quantity: 1, process1: null, doneProcess1: 0, addedProcesses: [], qaHeld: false, cotsQa: false };
    expect(computeStatus({ ...base, classification: "cots", designState: "In Route" })).toBe("In Route");
    expect(computeStatus({ ...base, classification: "cots", designState: "Gcoded" })).toBe("Not Started");
    expect(computeStatus({ ...base, classification: "inhouse", designState: "In Route" })).toBe("Not Started");
  });
});

describe("the amount to order", () => {
  const card = { quantity: 5, stockCount: 0, orderQty: null, restock: false, shelf: null };
  const shelf = { sheet: false, covered: 2, inStock: 3, total: 10 };
  it("follows the item's whole need on a card Inventory sent, so a new season need changes it", () => {
    expect(orderAmount({ ...card, restock: true, shelf })).toBe(7);
    expect(orderAmount({ ...card, restock: true, shelf: { ...shelf, total: 4 } })).toBe(1);
    expect(orderAmount({ ...card, restock: true, shelf: { ...shelf, total: 2 } })).toBe(0);
  });
  it("is the quantity less what the shelf covers on a BOM part, unless a member typed one", () => {
    expect(orderAmount({ ...card, shelf })).toBe(3);
    expect(orderAmount({ ...card, stockCount: 1 })).toBe(4);
    expect(orderAmount({ ...card, shelf, orderQty: 9 })).toBe(9);
    expect(orderAmount({ ...card, restock: true, shelf, orderQty: 0 })).toBe(0);
  });
});

describe("stock sizes in order names", () => {
  it("names a plate's sheet and a tube's length", () => {
    expect(stockSize({ category: "aluminum-plates", specs: { size: "500x900" }, name: "10 mm Aluminum plate" })).toBe("900×500");
    expect(stockSize({ category: "square-tubes", specs: { length: "1000" }, name: "25x25x1.5 box tube" })).toBe("1000 long");
    expect(stockSize({ category: "square-tubes", specs: {}, name: "40x20 box tube" })).toBeNull();
    expect(stockSize({ category: "bearings", specs: { size: "500x900" }, name: "x" })).toBeNull();
    expect(withStockSize("10 mm Aluminum plate", "900×500")).toBe("10 mm Aluminum plate · 900×500");
    expect(withStockSize("Aluminum plate 500x900", "900×500")).toBe("Aluminum plate 500x900");
  });
  it("copies a cart as a plain list", () => {
    expect(copyListText("Plates", [{ name: "10 mm Aluminum plate · 500×900", amount: 2 }])).toBe("Plates\n2 × 10 mm Aluminum plate · 500×900");
  });
});
