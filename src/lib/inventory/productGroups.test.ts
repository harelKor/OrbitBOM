import { describe, expect, it } from "vitest";
import { groupOffers } from "./productGroups";

describe("groupOffers", () => {
  it("puts the same product from two stores in one row, cheapest first", () => {
    const groups = groupOffers([
      { vendor: "WCP", url: "https://wcproducts.com/a", title: "Kraken X60 Powered by Talon FX", image: "a.png", price: 199.99 },
      { vendor: "CTRE", url: "https://store.ctr-electronics.com/k", title: "Kraken X60 (Powered by Talon FX)", image: null, price: 189.99 },
      { vendor: "WCP", url: "https://wcproducts.com/b", title: "Kraken X44 Powered by Talon FX", image: null, price: 159.99 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].offers.map((o) => o.vendor)).toEqual(["CTRE", "WCP"]);
    expect(groups[0].image).toBe("a.png");
  });
  it("joins by part number", () => {
    const groups = groupOffers([
      { vendor: "REV", url: "u1", title: "MAXSwerve Wheel", image: null, price: 10, sku: "REV-21-3005" },
      { vendor: "AndyMark", url: "u2", title: "REV Robotics 3in Wheel", image: null, price: 11, sku: "rev-21-3005" },
    ]);
    expect(groups).toHaveLength(1);
  });
  it("joins titles stores word differently when the model number is the same", () => {
    const groups = groupOffers([
      { vendor: "WCP", url: "u1", title: "Falcon 500 Brushless Motor", image: null, price: 180 },
      { vendor: "VEX", url: "u2", title: "Falcon 500 Powered by Talon FX", image: null, price: 190 },
      { vendor: "AndyMark", url: "u3", title: "Falcon 400 Brushless Motor", image: null, price: 150 },
    ]);
    expect(groups.map((g) => g.offers.map((o) => o.vendor))).toEqual([["WCP", "VEX"], ["AndyMark"]]);
  });
  it("keeps different products of the same size apart", () => {
    const groups = groupOffers([
      { vendor: "WCP", url: "u1", title: "8mm Hex Bearing", image: null, price: 3 },
      { vendor: "REV", url: "u2", title: "8mm Hex Shaft Collar", image: null, price: 2 },
      { vendor: "AndyMark", url: "u3", title: "Bearing 8mm Hex", image: null, price: 4 },
    ]);
    expect(groups.map((g) => g.offers.map((o) => o.vendor))).toEqual([["WCP", "AndyMark"], ["REV"]]);
  });
});
