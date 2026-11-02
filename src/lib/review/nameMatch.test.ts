import { describe, expect, it } from "vitest";
import { isDescriptiveName, matchByName, nameMatchSetup, type NameMatchItem } from "./nameMatch";

const item = (id: string, name: string, group: string, extra: Partial<NameMatchItem> = {}): NameMatchItem => ({
  id,
  name,
  aliases: [],
  category: undefined,
  specs: {},
  urls: [],
  onshapeKey: null,
  docKeys: [],
  thumbHashes: [],
  group,
  categoryId: group === "electrical" ? "motors" : "plates",
  cotsLinks: [],
  price: null,
  ...extra,
});
const part = (id: string, name: string) => ({ id, displayName: null, onshapeName: name, cotsLinks: [], unitPrice: null });

describe("isDescriptiveName", () => {
  it("tells part numbers from descriptive names", () => {
    for (const n of ["1690-26-411-01A", "1691-26-431", "P1690-26-411B <2>", "Part 12", "1690-26-411 (1)", null]) expect(isDescriptiveName(n)).toBe(false);
    for (const n of ["Kraken X60", "18T HTD Pulley", "688ZZ Bearing", "M5x16 SHCS", "1690-26-411 Kraken X60"]) expect(isDescriptiveName(n)).toBe(true);
  });
});

describe("matchByName", () => {
  const items = [item("k", "Kraken X60", "electrical", { price: 199, cotsLinks: [{ url: "https://wcproducts.com/kraken" }] }), item("p", "Aluminum 6061 plate", "consumables")];

  it("matches descriptive names only, and suggests COTS with the item's links and price", () => {
    const m = matchByName([part("a", "Kraken X60 <1>"), part("b", "1690-26-411")], items);
    expect([...m.keys()]).toEqual(["a"]);
    const s = nameMatchSetup({ ...part("a", "Kraken X60 <1>"), classification: "inhouse", material: "PLA", preProcess: null, process1: "3d-bambu", process2: null }, m.get("a")!);
    expect(s?.changes).toEqual({ inventoryItemId: "k", classification: "cots", cotsCategory: "motors", cotsLinks: [{ url: "https://wcproducts.com/kraken" }], unitPrice: 199, material: null, process1: null });
  });

  it("skips rejected pairs and leaves Raw Stock to the rules", () => {
    expect(matchByName([part("a", "Kraken X60")], items, (p, i) => p === "a" && i === "k").size).toBe(0);
    const m = matchByName([part("c", "Aluminum 6061 plate")], items);
    expect(nameMatchSetup({ ...part("c", "Aluminum 6061 plate"), classification: "undefined", material: null, preProcess: null, process1: null, process2: null }, m.get("c")!)).toBeNull();
  });
});
