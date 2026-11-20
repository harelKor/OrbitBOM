import { describe, expect, it } from "vitest";
import { CIRCLE_POINTS, circleOf, circleOfOutline, isPanoramaPicture, type MapPoint } from "@/lib/inventory/places";
import { clampPano, dragPano, facing, maxFov, mod1, project, unproject, zoomPano } from "./panorama";

const pic = { w: 2000, h: 667 };
const box = { w: 390, h: 300 };

describe("panorama", () => {
  it("knows a 360° picture by its shape", () => {
    expect(isPanoramaPicture(2000, 667)).toBe(true);
    expect(isPanoramaPicture(1448, 1086)).toBe(false);
    expect(isPanoramaPicture(null, 10)).toBe(false);
  });

  it("puts what it looks at in the middle of the screen", () => {
    const p = clampPano({ u: 0.3, v: 0.45, fov: 60 }, pic);
    const c = project(p, pic, box, p.u, p.v);
    expect(c.front).toBe(true);
    expect(c.x).toBeCloseTo(box.w / 2, 3);
    expect(c.y).toBeCloseTo(box.h / 2, 3);
    // Behind you is hidden; to the right is right.
    expect(project(p, pic, box, p.u + 0.5, 0.5).front).toBe(false);
    expect(project(p, pic, box, p.u + 0.05, p.v).x).toBeGreaterThan(box.w / 2);
  });

  it("finds the picture point under a screen point again", () => {
    const p = clampPano({ u: 0.97, v: 0.5, fov: 70 }, pic);
    for (const [u, v] of [[0.02, 0.4], [0.93, 0.6], [0.99, 0.5]]) {
      const s = project(p, pic, box, u, v);
      const back = unproject(p, pic, box, s.x, s.y);
      expect(mod1(back.u)).toBeCloseTo(u, 5);
      expect(back.v).toBeCloseTo(v, 5);
    }
  });

  it("keeps the point under the finger while dragging and zooming", () => {
    const p = clampPano({ u: 0.5, v: 0.5, fov: 60 }, pic);
    const under = unproject(p, pic, box, 100, 150);
    const moved = dragPano(p, pic, box, { x: 100, y: 150 }, { x: 180, y: 150 });
    const s = project(moved, pic, box, under.u, under.v);
    expect(s.x).toBeCloseTo(180, 1);
    const at = unproject(p, pic, box, 120, 140);
    const z = zoomPano(p, pic, box, 1.5, 120, 140);
    expect(z.fov).toBeCloseTo(40, 5);
    expect(project(z, pic, box, at.u, at.v).x).toBeCloseTo(120, 0);
    expect(project(z, pic, box, at.u, at.v).y).toBeCloseTo(140, 0);
  });

  it("never looks past the picture's top or bottom", () => {
    const up = clampPano({ u: 0, v: -1, fov: 60 }, pic);
    const top = unproject(up, pic, box, box.w / 2, 0);
    expect(top.v).toBeGreaterThanOrEqual(-1e-6);
    expect(clampPano({ u: 0, v: 0.5, fov: 170 }, pic).fov).toBe(maxFov(pic));
  });

  it("faces a group of points across the seam", () => {
    const f = facing([{ u: 0.95, v: 0.5 }, { u: 0.05, v: 0.5 }], pic, box);
    expect(Math.abs(f.u - 0) < 0.01 || Math.abs(f.u - 1) < 0.01).toBe(true);
  });

  it("turns a 360° zone into a circle of the same area, once", () => {
    const square: MapPoint[] = [[690, 479], [722, 479], [722, 505], [690, 505]];
    const circle = circleOf(square);
    expect(circle).toHaveLength(CIRCLE_POINTS);
    const { c, r } = circleOfOutline(circle);
    expect(c[0]).toBeCloseTo(706, 0);
    expect(c[1]).toBeCloseTo(492, 0);
    expect(Math.PI * r * r).toBeCloseTo(32 * 26, -1);
    expect(circleOf(circle)).toBe(circle);
  });
});
