import { expect, it } from "vitest";
import { suggestItem, type MatchItem } from "./match";

const items: MatchItem[] = [
  { id: "a", name: "608 Bearing", onshapeKey: null, aliases: ["608ZZ"], cotsLinks: [] },
  { id: "b", name: "Kraken X60", onshapeKey: "d:e:p", aliases: [], cotsLinks: [{ url: "https://wcproducts.com/products/kraken/" }] },
];

it("prefers the same Onshape part, then the product page, then the name", () => {
  expect(suggestItem({ displayName: "608 bearing", onshapeName: null, sourceDid: "d", sourceEid: "e", onshapePartId: "p" }, items)).toEqual({ itemId: "b", reason: "onshape" });
  expect(suggestItem({ displayName: "Motor", onshapeName: null, cotsLinks: [{ url: "http://www.wcproducts.com/products/kraken" }] }, items)).toEqual({ itemId: "b", reason: "link" });
  expect(suggestItem({ displayName: null, onshapeName: "608-bearing" }, items)).toEqual({ itemId: "a", reason: "name" });
  expect(suggestItem({ displayName: "608zz", onshapeName: null }, items)).toEqual({ itemId: "a", reason: "name" });
  expect(suggestItem({ displayName: "Gear", onshapeName: null }, items)).toBeNull();
});

it("doesn't take another length of a configurable screw for the item (audit, 2026-11-20)", () => {
  const screw: MatchItem = { id: "s", name: "M5×10 \u05db\u05d9\u05e4\u05d4", onshapeKey: "d:e:s", aliases: ["Socket button head screw M5x0.8 x 35"], cotsLinks: [] };
  const at = { sourceDid: "d", sourceEid: "e", onshapePartId: "s" };
  expect(suggestItem({ displayName: "Socket button head screw M5x0.8 x 10", onshapeName: null, ...at }, [screw])).toEqual({ itemId: "s", reason: "onshape" });
  expect(suggestItem({ displayName: "Socket button head screw M5x0.8 x 35", onshapeName: null, ...at }, [screw])).toBeNull();
});
