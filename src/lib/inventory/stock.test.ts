import { expect, it } from "vitest";
import { formatStock, parseStock, snapStock } from "./stock";

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
