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
});
