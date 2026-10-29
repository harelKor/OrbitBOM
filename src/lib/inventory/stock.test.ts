import { describe, expect, it } from "vitest";
import { formatStock, parseStock, snapStock } from "./stock";
import { adjustPieceBucket, canTakePiece, normalizePieces, pieceSizeLabel } from "./stock";

it("keeps sheets in twelfths and counts in whole units", () => {
  expect(snapStock(1 / 3 + 2 / 3, true)).toBe(1);
  expect(snapStock(2.4, false)).toBe(2);
  expect(snapStock(-1, true)).toBe(0);
});

it("shows sheet pieces as fractions", () => {
  expect(formatStock(2.75, true)).toBe("2 ¾");
  expect(formatStock(1 / 3, true)).toBe("⅓");
  expect(formatStock(5 / 12, true)).toBe("5/12");
  expect(formatStock(3, false)).toBe("3");
});

it("reads what people type", () => {
  expect(parseStock("2 3/4", true)).toBe(2.75);
  expect(parseStock("1 ⅓", true)).toBeCloseTo(4 / 3);
  expect(parseStock("4", false)).toBe(4);
  expect(parseStock("1/2", false)).toBeNull();
  expect(parseStock("lots", true)).toBeNull();
});

describe("pieces", () => {
  it("fills in pieces for old stock", () => {
    expect(normalizePieces(2.5, {})).toEqual({ "12": 2, "6": 1 });
    expect(normalizePieces(1 + 7 / 12, null)).toEqual({ "12": 1, "4": 1, "3": 1 });
    expect(normalizePieces(1, { "6": 2 })).toEqual({ "6": 2 });
  });
  it("steps one piece of a size", () => {
    expect(adjustPieceBucket(1, { "12": 1 }, 0.5, 6)).toEqual({ inStock: 1.5, pieces: { "12": 1, "6": 1 } });
    expect(adjustPieceBucket(1.5, { "12": 1, "6": 1 }, -0.5, 6)).toEqual({ inStock: 1, pieces: { "12": 1 } });
    // Taking a half with only a full on the shelf cuts it.
    expect(adjustPieceBucket(1, { "12": 1 }, -0.5, 6)).toEqual({ inStock: 0.5, pieces: { "6": 1 } });
  });
  it("−1 takes a full piece, else the biggest", () => {
    expect(adjustPieceBucket(1.75, { "12": 1, "9": 1 }, -1)).toEqual({ inStock: 0.75, pieces: { "9": 1 } });
    expect(adjustPieceBucket(1.25, { "9": 1, "6": 1 }, -1)).toEqual({ inStock: 0.5, pieces: { "6": 1 } });
    expect(adjustPieceBucket(0.5, { "6": 1 }, 1)).toEqual({ inStock: 1.5, pieces: { "12": 1, "6": 1 } });
  });
  it("takes other amounts as material", () => {
    expect(adjustPieceBucket(2, { "12": 2 }, -1.25)).toEqual({ inStock: 0.75, pieces: { "9": 1 } });
    expect(canTakePiece(0.5, { "6": 1 }, 9)).toBe(false);
    expect(canTakePiece(0.5, { "6": 1 }, 3)).toBe(true);
  });
  it("labels real sizes", () => {
    const half = { label: "½", value: 0.5 };
    expect(pieceSizeLabel(half, { length: "900" })).toEqual({ primary: "450mm", sub: "½" });
    expect(pieceSizeLabel(half, { length: "500mm" })).toEqual({ primary: "250mm", sub: "½" });
    expect(pieceSizeLabel(half, { size: "500x900" })).toEqual({ primary: "500×450", sub: "½" });
    expect(pieceSizeLabel(half, { size: "40x20" }, "40x20mm Box Tube 1000mm")).toEqual({ primary: "500mm", sub: "½" });
    expect(pieceSizeLabel(half, { od: "25" }, "Ø25mm 2mm wall Round Tube")).toEqual({ primary: "½" });
    expect(pieceSizeLabel({ label: "Full", value: 1 }, {})).toEqual({ primary: "Full" });
  });
});
