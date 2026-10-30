import { describe, expect, it } from "vitest";
import { pickVariant, variantImage, variantTitle, variantTokens, type ShopifyProduct } from "./shopifyVariant";

// A cut of AndyMark's Stealth and Sushi Wheels .json (2026-10-30).
const v = (id: number, title: string, sku: string) => ({ id, title, sku, price: "7.20" });
const stealth: ShopifyProduct = {
  title: "Stealth and Sushi Wheels",
  handle: "stealth-and-sushi-wheels",
  variants: [
    v(1, "1/2 in Hex / 2 inch / 35A", "am-3155_green"),
    v(2, "1/2 in Hex / 2 inch / 40A", "am-3155_orange"),
    v(3, "1/2 in Hex / 2 inch / 50A", "am-3155_blue"),
    v(4, "1/2 in Hex / 2 inch / 80A", "am-3155"),
    v(5, "3/8 in Hex / 2 inch / 50A", "am-3436_blue"),
    v(6, "1/2 in Hex / 3 inch / 50A", "am-4716_blue"),
    v(7, "1/2 in Hex / 1 inch / 35A", "am-4541_green"),
  ],
  images: [
    { id: 10, src: "https://cdn/am-stealthwheel_1.jpg", alt: "Stealth and Sushi Wheels - am-stealthwheel_1 - Image-1", variant_ids: [] },
    { id: 11, src: "https://cdn/am-3155_blue.jpg", alt: "x", variant_ids: [3] },
    // Untied: found by the SKU in its alt text.
    { id: 12, src: "https://cdn/am-3155.jpg", alt: "Stealth and Sushi Wheels - am-3155 - Durometer=80A, Bore=1/2 in Hex, Diameter=2 inch - migrated", variant_ids: [] },
  ],
};

describe("variantTokens", () => {
  it("reads sizes, bores, colors and durometers alike from names and options", () => {
    expect([...variantTokens('2" Stealth wheel – blue, 1/2" Hex')].sort()).toEqual(["1/2 hex", "2in", "blue"]);
    expect([...variantTokens("1/2 in Hex / 2 1/4 inch / 35A")].sort()).toEqual(["1/2 hex", "2-1/4in", "35a"]);
    expect(variantTokens('2.25" compliant').has("2-1/4in")).toBe(true);
    expect([...variantTokens("24T HTD pulley, 1/2 in Hex")].sort()).toEqual(["1/2 hex", "24t"]);
    expect(variantTokens("Gear 36 tooth").has("36t")).toBe(true);
    expect(variantTokens("5 mm Hex").has("5mm hex")).toBe(true);
  });
});

describe("pickVariant", () => {
  it("takes ?variant= first", () => {
    expect(pickVariant(stealth, { variantId: "6", want: "green" })?.id).toBe(6);
  });
  it("matches color, size and bore", () => {
    expect(pickVariant(stealth, { want: '2" Stealth wheel – blue 1/2" Hex' })?.id).toBe(3);
    expect(pickVariant(stealth, { want: '3" blue 1/2" Hex' })?.id).toBe(6);
  });
  it("lands a gray wheel on the variant with no color in its SKU, not a colored one", () => {
    expect(pickVariant(stealth, { want: '2" Stealth wheel – gray, 1/2" Hex' })?.id).toBe(4);
  });
  it("gives up on a tie rather than guess the bore", () => {
    expect(pickVariant(stealth, { want: '2" blue' })).toBeNull();
  });
  it("never takes a wrong size", () => {
    expect(pickVariant(stealth, { want: '4" green 1/2" Hex' })).toBeNull();
  });
});

describe("variantImage and variantTitle", () => {
  it("finds the variant's picture tied or by SKU, and names the variant", () => {
    expect(variantImage(stealth, stealth.variants[2])?.src).toBe("https://cdn/am-3155_blue.jpg");
    expect(variantImage(stealth, stealth.variants[3])?.src).toBe("https://cdn/am-3155.jpg");
    expect(variantTitle(stealth, stealth.variants[2])).toBe("Stealth and Sushi Wheels (1/2 in Hex / 2 inch / 50A)");
  });
});
