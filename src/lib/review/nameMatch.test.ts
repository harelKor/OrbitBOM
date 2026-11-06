import { describe, expect, it } from "vitest";
import { isDescriptiveName, looksLikeProduct, matchByName, nameMatchSetup, productSetup, type NameMatchItem } from "./nameMatch";

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

describe("looksLikeProduct", () => {
  it("knows bought parts by tooth counts, product words and vendors", () => {
    for (const n of ['18t Aluminum Pulley (HTD 5mm, 9mm Wide, 1/2" Hex Bore)', '2.25" Compliant Wheel (35A, 1" Wide, 1/2" Hex Bore)', "VersaPlanetary Ring Gear", "125T 5M 9mm Wide Belt", "Robot Radio (VH-109)"])
      expect(looksLikeProduct(n), n).toBe(true);
    for (const n of ["1691-26-411-04A", "1690-26-411-01A gear plate", '1/2" Hex (8.087 in)', "Part 12", "LshootMid02A"]) expect(looksLikeProduct(n), n).toBe(false);
  });
  it("makes such a part COTS and clears an in-house guess", () => {
    const s = productSetup({ classification: "inhouse", displayName: null, onshapeName: "24t Aluminum Spur Gear (20 DP)", material: "Aluminum - 6061", preProcess: null, process1: "cnc", process2: null });
    expect(s?.changes).toEqual({ classification: "cots", material: null, process1: null });
  });
});
