import { expect, it } from "vitest";
import { suggestItem, type MatchItem } from "./match";

const items: MatchItem[] = [
  { id: "a", name: "608 Bearing", onshapeKey: null, aliases: ["608ZZ"], vendorUrl: null },
  { id: "b", name: "Kraken X60", onshapeKey: "d:e:p", aliases: [], vendorUrl: "https://wcproducts.com/products/kraken/" },
];

it("prefers the same Onshape part, then the product page, then the name", () => {
  expect(suggestItem({ displayName: "608 bearing", onshapeName: null, sourceDid: "d", sourceEid: "e", onshapePartId: "p" }, items)).toEqual({ itemId: "b", reason: "onshape" });
  expect(suggestItem({ displayName: "Motor", onshapeName: null, cotsLinks: [{ url: "http://www.wcproducts.com/products/kraken" }] }, items)).toEqual({ itemId: "b", reason: "link" });
  expect(suggestItem({ displayName: null, onshapeName: "608-bearing" }, items)).toEqual({ itemId: "a", reason: "name" });
  expect(suggestItem({ displayName: "608zz", onshapeName: null }, items)).toEqual({ itemId: "a", reason: "name" });
  expect(suggestItem({ displayName: "Gear", onshapeName: null }, items)).toBeNull();
});
