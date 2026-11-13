import { describe, expect, it } from "vitest";
import { nearestCorner, nearestOnLine, seen, seenTolerance, type ScreenPoint } from "./pickSeen";

// A square tube seen face-on: the pointer is on the front face (hit at depth 1.00 m); the tube's
// back edge (depth 1.05) projects 2 px from the pointer, a front edge 8 px away.
const hitDepth = 1;
const tol = seenTolerance(0.0001);
const ok = (p: ScreenPoint) => seen(p.d, hitDepth, tol);
const back: ScreenPoint[] = [{ x: 0, y: 102, d: 1.05 }, { x: 400, y: 102, d: 1.05 }];
const front: ScreenPoint[] = [{ x: 0, y: 108, d: 1 }, { x: 400, y: 108, d: 1 }];

describe("only seen corners and edges pre-select", () => {
  it("skips an edge behind the hit face, however near on screen", () => {
    expect(nearestOnLine(back, false, 200, 100, ok)).toBe(Infinity);
    expect(nearestOnLine(front, false, 200, 100, ok)).toBeCloseTo(8);
  });
  it("takes a hidden edge when it borders the hit face", () => {
    expect(nearestOnLine(back, false, 200, 100, () => true)).toBeCloseTo(2);
  });
  it("uses the depth at the nearest point of a slanted edge", () => {
    // Runs from in front of the face to behind it; the pointer is near its far (hidden) end.
    const slant: ScreenPoint[] = [{ x: 0, y: 100, d: 0.9 }, { x: 400, y: 100, d: 1.1 }];
    expect(nearestOnLine(slant, false, 390, 100, ok)).toBe(Infinity);
    expect(nearestOnLine(slant, false, 10, 100, ok)).toBe(0);
  });
  it("allows a few tenths of a mm, more when zoomed out", () => {
    expect(seen(1.0002, 1, seenTolerance(0))).toBe(true);
    expect(seen(1.001, 1, seenTolerance(0))).toBe(false);
    expect(seen(1.004, 1, seenTolerance(0.0025))).toBe(true);
  });
  it("picks the nearest seen corner", () => {
    const corners = [back[0], front[0], { x: 3, y: 101, d: 1.05 }];
    expect(nearestCorner(corners, 0, 100, 10, (_, p) => ok(p))).toEqual({ n: 1, dist: 8 });
    expect(nearestCorner(corners, 0, 100, 10, () => true).n).toBe(0);
  });
});
