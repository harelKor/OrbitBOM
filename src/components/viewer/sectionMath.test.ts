import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { alongLine, axisPlane, axisSpan, clipPlane, contour, keptBy, cylinderMeetsBox, defaultPlane, faceCylinder, facePlane, inPlaneAxes, offsetRange, planeAt, rayCylinder, removedBy, ringAngle, splitPlane, tiltedNormal, viewDirection, wrapDeg } from "./sectionMath";

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

describe("default planes", () => {
  it("cut the side their standard view looks from, through the model centre", () => {
    const front = defaultPlane("front", box);
    expect(front.origin).toEqual([0, 2, 4]);
    expect(removedBy(front, v(0, 1, 4))).toBe(true); // -Y of the centre: towards the Front view
    expect(removedBy(front, v(0, 3, 4))).toBe(false);
    expect(removedBy(defaultPlane("top", box), v(0, 2, 5))).toBe(true);
    expect(removedBy(defaultPlane("right", box), v(0.5, 2, 4))).toBe(true);
    // N looks at the cut from the side it took away.
    expect(viewDirection(front).toArray()).toEqual([0, -1, 0]);
  });
});

describe("cylinders", () => {
  // A 16 mm hole along Z through (0.1, 0.2), clicked at its wall on +X; the face's outward normal
  // there points into the hole (towards the axis).
  const hole = faceCylinder([0.1, 0.2, 0], [0, 0, 2], 0.008, [0.108, 0.2, 0.05], [-1, 0, 0]);

  it("sit on the face's axis level with the click, the handle towards it", () => {
    expect(hole.origin[0]).toBeCloseTo(0.1);
    expect(hole.origin[2]).toBeCloseTo(0.05);
    expect(hole.axis).toEqual([0, 0, 1]);
    expect(hole.ref[0]).toBeCloseTo(1);
    expect(hole.radius).toBeCloseTo(8);
  });

  it("cut away a hole's inside and a shaft's outside, Flip the other way", () => {
    expect(hole.flip).toBe(false);
    expect(removedBy(hole, v(0.1, 0.2, 1))).toBe(true); // on the axis, any height
    expect(removedBy(hole, v(0.107, 0.2, 0))).toBe(true);
    expect(removedBy(hole, v(0.109, 0.2, 0))).toBe(false);
    expect(removedBy({ ...hole, flip: true }, v(0.109, 0.2, 0))).toBe(true);
    expect(removedBy({ ...hole, flip: true }, v(0.107, 0.2, 0))).toBe(false);
    const shaft = faceCylinder([0, 0, 0], [1, 0, 0], 0.004, [0.3, 0, 0.004], [0, 0, 1]);
    expect(shaft.flip).toBe(true);
    expect(removedBy(shaft, v(0.5, 0, 0.005))).toBe(true);
    expect(removedBy(shaft, v(0.5, 0, 0.003))).toBe(false);
  });

  it("grow by the offset in mm, never below 0.1 mm", () => {
    expect(removedBy({ ...hole, offset: 2 }, v(0.1095, 0.2, 0))).toBe(true); // 10 mm now
    expect(removedBy({ ...hole, offset: -50 }, v(0.1002, 0.2, 0))).toBe(false);
  });

  it("know the stretch of axis a box spans, for the cap tube", () => {
    const span = axisSpan([0, 0, 0], [0, 0, 1], box);
    expect(span.centre.z).toBeCloseTo(4);
    expect(span.length).toBeGreaterThan(4);
    expect(span.length).toBeLessThan(4.3);
  });

  it("meet a box only when its surface can reach it", () => {
    const c = faceCylinder([0, 0, 0], [0, 0, 1], 0.5, [0.5, 0, 0], [1, 0, 0]);
    expect(cylinderMeetsBox(c, new THREE.Box3(v(0.4, -0.1, 0), v(0.6, 0.1, 1)))).toBe(true);
    expect(cylinderMeetsBox(c, new THREE.Box3(v(-0.1, -0.1, 0), v(0.1, 0.1, 1)))).toBe(false); // well inside
    expect(cylinderMeetsBox(c, new THREE.Box3(v(3, 3, 0), v(3.1, 3.1, 1)))).toBe(false); // well outside
  });

  it("are crossed twice by a ray through them, nearest first", () => {
    const c = faceCylinder([0, 0, 0], [0, 0, 1], 1, [1, 0, 0], [1, 0, 0]);
    const t = rayCylinder(v(-5, 0, 3), v(1, 0, 0), c)!;
    expect(t[0]).toBeCloseTo(4);
    expect(t[1]).toBeCloseTo(6);
    expect(rayCylinder(v(-5, 2, 3), v(1, 0, 0), c)).toBeNull();
    expect(rayCylinder(v(0, 0, 3), v(0, 0, 1), c)).toBeNull(); // along the axis
  });

  it("split each line of sight into its near and far crossing, square to the view", () => {
    const s = splitPlane(v(0, 0, 0), v(0, 0, 1), v(3, 0, 2));
    expect(s.normal.toArray().map((x) => Math.round(x * 1e6) / 1e6)).toEqual([1, 0, 0]);
    expect(s.distanceToPoint(v(1, 0, 0))).toBeGreaterThan(0); // the near crossing, towards the camera
    expect(s.distanceToPoint(v(-1, 0, 0))).toBeLessThan(0);
    // Looking straight down the axis: still a plane through it.
    expect(splitPlane(v(0, 0, 0), v(0, 0, 1), v(0, 0, 5)).distanceToPoint(v(0, 0, 0))).toBeCloseTo(0);
  });
});

describe("cut outlines", () => {
  // A 2 × 2 × 2 m box around the origin, as 12 triangles.
  const P = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
  const I = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const lengthOf = (s: number[]) => {
    let l = 0;
    for (let k = 0; k < s.length; k += 6) l += Math.hypot(s[k + 3] - s[k], s[k + 4] - s[k + 1], s[k + 5] - s[k + 2]);
    return l;
  };

  it("run round the cut face: a plane through a box gives its square", () => {
    const out: number[] = [];
    contour(P, I, new THREE.Matrix4(), facePlane([0, 0, 0.5], [0, 0, 1]), [], out);
    expect(lengthOf(out)).toBeCloseTo(8, 3); // 4 sides of 2 m
    for (let k = 2; k < out.length; k += 3) expect(out[k]).toBeGreaterThan(0.5); // a hair into the cut-away side
  });

  it("leave out what another cut takes away", () => {
    const out: number[] = [];
    contour(P, I, new THREE.Matrix4(), facePlane([0, 0, 0.5], [0, 0, 1]), [facePlane([0.5, 0, 0], [1, 0, 0])], out);
    expect(lengthOf(out)).toBeLessThan(8);
    expect(lengthOf(out)).toBeGreaterThan(4);
  });

  it("follow a cylinder at its radius", () => {
    // 1.2 m: past the middle of each side, short of its corners.
    const c = faceCylinder([0, 0, 0], [0, 0, 1], 1.2, [1.2, 0, 0], [-1, 0, 0]);
    const out: number[] = [];
    contour(P, I, new THREE.Matrix4(), c, [], out);
    expect(lengthOf(out)).toBeGreaterThan(16); // 2 upright lines on each side, plus top and bottom
    for (let k = 0; k < out.length; k += 3) expect(Math.hypot(out[k], out[k + 1])).toBeCloseTo(1.2, 4);
    expect(keptBy(c)(v(0, 0, 0))).toBeLessThan(0);
    expect(keptBy(c)(v(1.3, 0, 0))).toBeGreaterThan(0);
  });
});
