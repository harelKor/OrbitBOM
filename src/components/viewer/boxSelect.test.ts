import { describe, expect, it } from "vitest";
import { segmentMeetsRect } from "./picking";

describe("segmentMeetsRect", () => {
  const box = [10, 10, 20, 20] as const;
  it("takes a segment crossing the box with both ends outside", () => {
    expect(segmentMeetsRect(15, 0, 15, 30, ...box)).toBe(true);
    expect(segmentMeetsRect(0, 0, 30, 30, ...box)).toBe(true);
  });
  it("takes a segment with an end inside", () => {
    expect(segmentMeetsRect(15, 15, 40, 40, ...box)).toBe(true);
  });
  it("leaves segments that pass by", () => {
    expect(segmentMeetsRect(0, 0, 30, 0, ...box)).toBe(false);
    expect(segmentMeetsRect(0, 25, 25, 50, ...box)).toBe(false);
    expect(segmentMeetsRect(25, 0, 25, 30, ...box)).toBe(false);
  });
});
