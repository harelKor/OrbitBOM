import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { alongLine, axisPlane, clipPlane, facePlane, inPlaneAxes, offsetRange, planeAt, ringAngle, tiltedNormal, wrapDeg } from "./sectionMath";

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
// The model's box in metres: x -1…1, y 0…4, z 2…6.
const box = new THREE.Box3(v(-1, 0, 2), v(1, 4, 6));

describe("axis planes", () => {
  it("run through the model centre and keep the side behind the normal", () => {
    const p = axisPlane("z", box);
    expect(p.origin).toEqual([0, 2, 4]);
    const c = clipPlane(p);
    expect(c.distanceToPoint(v(0, 0, 3.9))).toBeGreaterThan(0); // kept
    expect(c.distanceToPoint(v(0, 0, 4.1))).toBeLessThan(0); // cut away
  });

  it("move by the offset in mm, and Flip keeps the other side", () => {
    const p = { ...axisPlane("x", box), offset: 250 };
    expect(planeAt(p).point.x).toBeCloseTo(0.25);
    const c = clipPlane(p);
    expect(c.distanceToPoint(v(0.24, 1, 3))).toBeGreaterThan(0);
    expect(c.distanceToPoint(v(0.26, 1, 3))).toBeLessThan(0);
    const f = clipPlane({ ...p, flip: true });
    expect(f.distanceToPoint(v(0.26, 1, 3))).toBeGreaterThan(0);
    expect(f.distanceToPoint(v(0.24, 1, 3))).toBeLessThan(0);
  });

  it("give the slider the offsets at which the plane still meets the box", () => {
    expect(offsetRange(axisPlane("y", box), box)).toEqual([-2000, 2000]);
    expect(offsetRange(axisPlane("x", box), box)).toEqual([-1000, 1000]);
  });
});

describe("face planes", () => {
  it("lie on the face at offset 0, keeping the face itself, and cut into the part going negative", () => {
    // The top face of a 6.35 mm plate at z = 0.1, normal up.
    const p = facePlane([0.3, 0.2, 0.1], [0, 0, 2]);
    expect(p.normal).toEqual([0, 0, 1]);
    const at0 = clipPlane(p);
    expect(at0.distanceToPoint(v(0.3, 0.2, 0.1))).toBeGreaterThan(0); // the face stays drawn
    expect(at0.distanceToPoint(v(0, 0, 0.1001))).toBeLessThan(0);
    const into = clipPlane({ ...p, offset: -3 });
    // 3 mm into the plate: z = 0.097.
    expect(into.distanceToPoint(v(0, 0, 0.0969))).toBeGreaterThan(0);
    expect(into.distanceToPoint(v(0, 0, 0.0971))).toBeLessThan(0);
  });

  it("measure the range from the face, not the centre", () => {
    const p = facePlane([0, 0, 6], [0, 0, 1]); // on the box's top
    expect(offsetRange(p, box)).toEqual([-4000, 0]);
  });
});

describe("tilt", () => {
  it("finds two in-plane axes at right angles to the normal", () => {
    for (const n of [v(0, 0, 1), v(1, 0, 0), v(0, 1, 0), v(1, 2, 3).normalize()]) {
      const [a, b] = inPlaneAxes(n);
      expect(a.dot(n)).toBeCloseTo(0);
      expect(b.dot(n)).toBeCloseTo(0);
      expect(a.dot(b)).toBeCloseTo(0);
      expect(a.length()).toBeCloseTo(1);
      expect(b.length()).toBeCloseTo(1);
    }
    // A Z plane gets X and Y.
    const [u, w] = inPlaneAxes(v(0, 0, 1));
    expect(u.toArray().map((x) => Math.round(x))).toEqual([1, 0, 0]);
    expect(w.toArray().map((x) => Math.round(x))).toEqual([0, 1, 0]);
  });

  it("turns the normal by the given degrees", () => {
    const p = { ...axisPlane("z", box), tilt: [30, 0] as [number, number] };
    const n = tiltedNormal(p);
    expect(n.angleTo(v(0, 0, 1))).toBeCloseTo(Math.PI / 6);
    expect(n.x).toBeCloseTo(0); // about X: the normal leans in Y
    const both = tiltedNormal({ ...p, tilt: [0, 45] });
    expect(both.angleTo(v(0, 0, 1))).toBeCloseTo(Math.PI / 4);
    expect(both.y).toBeCloseTo(0);
  });

  it("tilts the plane about its point, so the offset still moves along the tilted normal", () => {
    const p = { ...axisPlane("z", box), tilt: [20, 10] as [number, number], offset: 100 };
    const { normal, point } = planeAt(p);
    expect(point.clone().sub(v(0, 2, 4)).length()).toBeCloseTo(0.1);
    expect(point.clone().sub(v(0, 2, 4)).normalize().dot(normal)).toBeCloseTo(1);
  });
});

describe("handle drags", () => {
  it("finds how far along the arrow the pointer's ray passes closest", () => {
    // Arrow along Z from the origin; a ray along X crossing z = 0.3.
    expect(alongLine(v(-5, 0, 0.3), v(1, 0, 0), v(0, 0, 0), v(0, 0, 1))).toBeCloseTo(0.3);
    // A ray along the arrow itself gives nothing.
    expect(alongLine(v(0, 0, -5), v(0, 0, 1), v(0, 0, 0), v(0, 0, 1))).toBeNull();
  });

  it("measures the ring angle about its axis", () => {
    // Ring about Z through the origin, angles from X; a ray straight down onto (0, 1, 0).
    const a = ringAngle(v(0, 1, 5), v(0, 0, -1), v(0, 0, 0), v(0, 0, 1), v(1, 0, 0));
    expect(a).toBeCloseTo(Math.PI / 2);
    expect(ringAngle(v(0, 1, 5), v(1, 0, 0), v(0, 0, 0), v(0, 0, 1), v(1, 0, 0))).toBeNull();
  });

  it("wraps angles into (-180, 180]", () => {
    expect(wrapDeg(190)).toBe(-170);
    expect(wrapDeg(-180)).toBe(180);
    expect(wrapDeg(540)).toBe(180);
    expect(wrapDeg(-30)).toBe(-30);
  });
});
