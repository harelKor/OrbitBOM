import { describe, expect, it } from "vitest";
import { advisePlate, cornerOf, flattenMesh, footprint, nestParts, placementMatrix, type FlatPart } from "./layout";

type V = [number, number, number];
// A 200 × 100 × 6 plate with a 100 × 50 pocket 3mm deep in its top face, as triangles (mm).
function pocketedPlate(): V[][] {
  const quad = (a: V, b: V, c: V, d: V): V[][] => [[a, b, c], [a, c, d]];
  const rect = (x0: number, y0: number, x1: number, y1: number, z: number) => quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]);
  return [
    ...rect(0, 0, 200, 100, 0),
    // top face around the pocket (50..150, 25..75)
    ...rect(0, 0, 200, 25, 6),
    ...rect(0, 75, 200, 100, 6),
    ...rect(0, 25, 50, 75, 6),
    ...rect(150, 25, 200, 75, 6),
    ...rect(50, 25, 150, 75, 3), // pocket floor
    ...quad([0, 0, 0], [200, 0, 0], [200, 0, 6], [0, 0, 6]),
    ...quad([0, 100, 0], [200, 100, 0], [200, 100, 6], [0, 100, 6]),
    ...quad([0, 0, 0], [0, 100, 0], [0, 100, 6], [0, 0, 6]),
    ...quad([200, 0, 0], [200, 100, 0], [200, 100, 6], [200, 0, 6]),
  ];
}

// Tilt it (rotations about X then Z), flip it upside down when asked, move it, and pack as metres.
function mesh(tris: V[][], flip: boolean) {
  const [a, b] = [0.7, 1.1];
  const tx = (p: V): V => {
    let [x, y, z] = p;
    if (flip) [y, z] = [-y, -z];
    [y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
    [x, y] = [x * Math.cos(b) - y * Math.sin(b), x * Math.sin(b) + y * Math.cos(b)];
    return [x + 37, y - 12, z + 400];
  };
  const pos: number[] = [];
  for (const t of tris) for (const p of t) pos.push(...tx(p).map((n) => n / 1000));
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(pos.map((_, i) => i).filter((i) => i < pos.length / 3)), raw: tris.flat().map(tx) };
}

const apply = (m: number[], p: V): V => [0, 1, 2].map((r) => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3]) as V;
const det3 = (m: number[]) =>
  m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);

describe("flattenMesh", () => {
  for (const flip of [false, true]) {
    it(`lays a tilted pocketed plate flat, pockets up${flip ? " (modelled upside down)" : ""}`, () => {
      const { positions, indices, raw } = mesh(pocketedPlate(), flip);
      const g = flattenMesh(positions, indices)!;
      expect(g.w).toBeCloseTo(200, 1);
      expect(g.h).toBeCloseTo(100, 1);
      expect(g.thickness).toBeCloseTo(6, 1);
      expect(det3(g.flatten)).toBeCloseTo(1, 4);
      const flat = raw.map((p) => apply(g.flatten, p));
      expect(Math.min(...flat.map((p) => p[2]))).toBeCloseTo(0, 1);
      expect(Math.max(...flat.map((p) => p[2]))).toBeCloseTo(6, 1);
      // The pocket floor sits at Z = 3 and nothing else between: the pocket opens upward.
      const pocket = flat.filter((p) => p[2] > 1 && p[2] < 5);
      expect(pocket.length).toBeGreaterThan(0);
      pocket.forEach((p) => expect(p[2]).toBeCloseTo(3, 1));
      expect(g.outline.length).toBe(4);
      expect(g.plate).toBe(true);
    });
  }
});

describe("nesting", () => {
  const part = (id: string, w: number, h: number, quantity: number): FlatPart => ({
    partId: id, name: id, quantity, w, h, thickness: 6, outline: [], holes: [], plate: true,
    flatten: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  });
  const parts = [part("a", 200, 100, 2), part("b", 120, 80, 3), part("c", 300, 40, 1)];

  it("places every copy apart by the gap, inside the margin", () => {
    const nest = nestParts(parts, { sheetW: 500, gap: 8, margin: 10 });
    expect(nest.unplaced).toHaveLength(0);
    expect(nest.placements).toHaveLength(6);
    const boxes = nest.placements.map((p) => {
      const pt = parts.find((x) => x.partId === p.partId)!;
      const [x, y] = cornerOf(pt, p);
      const [w, h] = footprint(pt, p.rotation);
      return { x, y, w, h };
    });
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(b.x + b.w).toBeLessThanOrEqual(490 + 1e-6);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        const apart = a.x + a.w + 8 <= b.x + 1e-6 || b.x + b.w + 8 <= a.x + 1e-6 || a.y + a.h + 8 <= b.y + 1e-6 || b.y + b.h + 8 <= a.y + 1e-6;
        expect(apart).toBe(true);
      }
  });

  it("composes T · Rz · flatten so a turned copy lands on its box", () => {
    const pt = part("a", 200, 100, 1);
    for (const rotation of [0, 90, 180, 270] as const) {
      const pl = { x: 0, y: 0, rotation };
      const [cx, cy] = cornerOf(pt, pl);
      const moved = { x: pl.x + 50 - cx, y: pl.y + 70 - cy, rotation };
      const m = placementMatrix(pt, moved);
      const corners = [[0, 0, 0], [200, 0, 0], [200, 100, 0], [0, 100, 0]].map((p) => apply(m, p as V));
      expect(Math.min(...corners.map((c) => c[0]))).toBeCloseTo(50);
      expect(Math.min(...corners.map((c) => c[1]))).toBeCloseTo(70);
    }
  });

  it("places a copy turned by any angle on its box", () => {
    const pt = part("a", 200, 100, 1);
    for (const rotation of [5, -37, 123.5]) {
      const pl = { x: 300, y: -40, rotation };
      const [cx, cy] = cornerOf(pt, pl);
      const [fw, fh] = footprint(pt, rotation);
      const m = placementMatrix(pt, pl);
      const corners = [[0, 0, 0], [200, 0, 0], [200, 100, 0], [0, 100, 0]].map((p) => apply(m, p as V));
      expect(Math.min(...corners.map((c) => c[0]))).toBeCloseTo(cx);
      expect(Math.min(...corners.map((c) => c[1]))).toBeCloseTo(cy);
      expect(Math.max(...corners.map((c) => c[0]))).toBeCloseTo(cx + fw);
      expect(Math.max(...corners.map((c) => c[1]))).toBeCloseTo(cy + fh);
      expect(det3(m)).toBeCloseTo(1, 6);
    }
  });

  it("recommends the smallest stock piece that fits", () => {
    const pieces = [
      { size: "f12", label: "500×900", share: "Full", x: 500, y: 900, count: 1 },
      { size: "f6", label: "500×450", share: "½", x: 500, y: 450, count: 2 },
      { size: "p200x200", label: "200×200", share: "", x: 200, y: 200, count: 4 },
      { size: "p600x600", label: "600×600", share: "", x: 600, y: 600, count: 0 },
    ];
    const { advice, nest } = advisePlate(parts, pieces);
    expect(advice.piece?.size).toBe("f6");
    expect(nest.unplaced).toHaveLength(0);
    const tooBig = advisePlate([part("x", 450, 450, 4)], pieces);
    expect(tooBig.advice.piece).toBeNull();
    expect(tooBig.advice.sheetsNeeded).toBe(4);
  });
});
