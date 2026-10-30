import { describe, expect, it } from "vitest";
import { formatStock, parseStock, snapStock } from "./stock";
import { applyPieceOp, canTakePiece, fractionText, parseSize, pieceBase, pieceLabel, stepStock } from "./stock";

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
  const tube = { sheet: true, specs: { length: "900" }, name: "Shaft" };
  const plate = { sheet: true, specs: { size: "500x900" }, name: "Plate" };
  const counts = (r: { pieces?: { size: string; count: number }[] }) => Object.fromEntries((r.pieces ?? []).filter((p) => p.count).map((p) => [p.size, p.count]));
  it("reads old stock as presets", () => {
    expect(counts(stepStock({ ...tube, inStock: 2.5, pieces: {} }, 0.5, "f6"))).toEqual({ f12: 2, f6: 2 });
    expect(counts(stepStock({ ...tube, inStock: 1, pieces: { "6": 2 } }, 1))).toEqual({ f12: 1, f6: 2 });
  });
  it("cuts a size from a bigger piece", () => {
    const r = stepStock({ ...tube, inStock: 1, pieces: [{ size: "f12", count: 1 }] }, -0.5, "m300");
    expect(counts(r)).toEqual({ f8: 1 }); // 600mm is ⅔
    expect(r.inStock).toBeCloseTo(2 / 3, 3);
  });
  it("−1 takes a full piece, else the biggest", () => {
    expect(counts(stepStock({ ...tube, inStock: 1.25, pieces: { "9": 1, "6": 1 } }, -1))).toEqual({ f6: 1 });
  });
  it("custom sizes count by their share", () => {
    const r = applyPieceOp({ ...tube, inStock: 0, pieces: [] }, { kind: "count", size: "m1125", count: 2 });
    expect(r.inStock).toBe(2.5);
    expect(fractionText(1125 / 900)).toBe("5/4");
    expect(fractionText(3)).toBe("3/1");
    const p = applyPieceOp({ ...plate, inStock: 0, pieces: [] }, { kind: "count", size: "p500x450", count: 3 });
    expect(p.inStock).toBe(1.5);
    expect(canTakePiece({ ...plate, ...p }, "f12")).toBe(false);
  });
  it("labels real sizes", () => {
    expect(pieceLabel("f6", pieceBase({ length: "900" }))).toEqual({ primary: "450mm", sub: "½" });
    expect(pieceLabel("f6", pieceBase({ size: "500x900" }))).toEqual({ primary: "500×450", sub: "½" });
    expect(pieceLabel("f6", pieceBase({ size: "40x20" }, "40x20mm Box Tube 1000mm"))).toEqual({ primary: "500mm", sub: "½" });
    expect(pieceLabel("f6", pieceBase({}, "Ø25mm 2mm wall Round Tube"))).toEqual({ primary: "½", sub: "" });
    expect(parseSize("500 x 450", pieceBase({ size: "500x900" }))).toBe("p500x450");
    expect(parseSize("450", pieceBase({ length: "900" }))).toBe("m450");
  });
});
