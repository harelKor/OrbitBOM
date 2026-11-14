import { expect, it } from "vitest";
import { safeNext } from "./safeNext";

it("keeps same-site paths and drops anything else", () => {
  expect(safeNext("/members?x=1")).toBe("/members?x=1");
  expect(safeNext(null)).toBe("/");
  expect(safeNext("https://evil.com")).toBe("/");
  expect(safeNext("//evil.com")).toBe("/");
  expect(safeNext("/\\evil.com")).toBe("/");
});

it("refuses control characters a browser would drop", () => {
  expect(safeNext("/\t/evil.com")).toBe("/");
  expect(safeNext("/\n/evil.com")).toBe("/");
  expect(safeNext("/robots/\u0000")).toBe("/");
});
