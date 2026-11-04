import { describe, expect, it } from "vitest";
import { cartKind, cartUrl, linkVariant } from "./cotsCart";

describe("cartKind", () => {
  it("knows Shopify product pages and Amazon products", () => {
    expect(cartKind("https://wcproducts.com/products/wcp-0123")).toBe("shopify");
    expect(cartKind("https://www.andymark.com/products/am-3462?variant=4567")).toBe("shopify");
    expect(cartKind("https://www.amazon.com/Some-Thing/dp/B07XYZ1234/ref=sr_1")).toBe("amazon");
  });
  it("has no cart for other stores or non-product pages", () => {
    expect(cartKind("https://www.revrobotics.com/rev-21-1650/")).toBeNull();
    expect(cartKind("https://wcproducts.com/collections/gears")).toBeNull();
    expect(cartKind("https://www.amazon.com/s?k=zip+ties")).toBeNull();
    expect(cartKind("not a link")).toBeNull();
    expect(cartKind(null)).toBeNull();
  });
});

describe("cartUrl", () => {
  it("makes a Shopify cart permalink, adding up the same variant", () => {
    expect(
      cartUrl([
        { url: "https://www.andymark.com/products/a?variant=11", quantity: 2 },
        { url: "https://andymark.com/products/b", quantity: 1, variantId: "22" },
        { url: "https://www.andymark.com/products/a?variant=11", quantity: 3 },
      ]),
    ).toBe("https://www.andymark.com/cart/11:5,22:1");
  });
  it("makes an Amazon add-to-cart link", () => {
    expect(
      cartUrl([
        { url: "https://www.amazon.com/dp/B07XYZ1234", quantity: 4 },
        { url: "https://www.amazon.com/gp/product/b0abcdefgh?th=1", quantity: 0 },
      ]),
    ).toBe("https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=B07XYZ1234&Quantity.1=4&ASIN.2=B0ABCDEFGH&Quantity.2=1");
  });
  it("refuses mixed stores and Shopify lines with no variant", () => {
    expect(cartUrl([{ url: "https://wcproducts.com/products/a?variant=1", quantity: 1 }, { url: "https://www.andymark.com/products/b?variant=2", quantity: 1 }])).toBeNull();
    expect(cartUrl([{ url: "https://wcproducts.com/products/a", quantity: 1 }])).toBeNull();
    expect(cartUrl([])).toBeNull();
  });
  it("reads a link's variant", () => {
    expect(linkVariant("https://wcproducts.com/products/a?variant=123")).toBe("123");
    expect(linkVariant("https://wcproducts.com/products/a")).toBeNull();
  });
});
