import { describe, expect, it } from "vitest";
import { measure, placeEdge, placeFace, placePoint } from "./measure";
import { topology, type V3 } from "./topology";

// Meshes as Onshape exports them: each face with its own vertices.
function mesh(faces: { pts: V3[]; tris: number[][] }[]) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const f of faces) {
    const base = pos.length / 3;
    for (const p of f.pts) pos.push(...p);
    for (const t of f.tris) idx.push(...t.map((i) => base + i));
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
const quad = (a: V3, b: V3, c: V3, d: V3) => ({ pts: [a, b, c, d], tris: [[0, 1, 2], [0, 2, 3]] });
function box(x: number, y: number, z: number) {
  return mesh([
    quad([0, 0, z], [x, 0, z], [x, y, z], [0, y, z]),
    quad([0, y, 0], [x, y, 0], [x, 0, 0], [0, 0, 0]),
    quad([0, 0, 0], [x, 0, 0], [x, 0, z], [0, 0, z]),
    quad([0, y, z], [x, y, z], [x, y, 0], [0, y, 0]),
    quad([x, 0, 0], [x, y, 0], [x, y, z], [x, 0, z]),
    quad([0, 0, z], [0, y, z], [0, y, 0], [0, 0, 0]),
  ]);
}
function cylinder(r: number, h: number, n = 48) {
  const ring = (z: number) => Array.from({ length: n }, (_, i) => [r * Math.cos((i / n) * 2 * Math.PI), r * Math.sin((i / n) * 2 * Math.PI), z] as V3);
  const side = { pts: [...ring(0), ...ring(h)], tris: Array.from({ length: n }, (_, i) => [[i, (i + 1) % n, n + ((i + 1) % n)], [i, n + ((i + 1) % n), n + i]]).flat() };
  const cap = (z: number) => ({ pts: ring(z), tris: Array.from({ length: n - 2 }, (_, i) => [0, i + 1, i + 2]) });
  return mesh([side, cap(0), cap(h)]);
}
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const moved = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];

describe("part faces, edges and corners from the mesh", () => {
  it("a box: 6 flat faces, 12 straight edges, 8 corners", () => {
    const { pos, idx } = box(0.1, 0.05, 0.006);
    const t = topology(pos, idx);
    expect(t.faces).toHaveLength(6);
    expect(t.faces.every((f) => f.kind === "plane")).toBe(true);
    expect(t.edges).toHaveLength(12);
    expect(t.edges.every((e) => e.kind === "line")).toBe(true);
    expect(t.edges.map((e) => Math.round(e.length * 1e4)).sort((a, b) => a - b)).toEqual([60, 60, 60, 60, 500, 500, 500, 500, 1000, 1000, 1000, 1000]);
    expect(t.corners).toHaveLength(8);
  });

  it("a cylinder: its radius and axis, two round edges", () => {
    const { pos, idx } = cylinder(0.004, 0.02);
    const t = topology(pos, idx);
    const side = t.faces.find((f) => f.kind === "cylinder")!;
    expect(side.radius).toBeCloseTo(0.004, 6);
    expect(Math.abs(side.axis![2])).toBeCloseTo(1, 6);
    expect(t.faces.filter((f) => f.kind === "plane")).toHaveLength(2);
    const round = t.edges.filter((e) => e.kind === "circle");
    expect(round).toHaveLength(2);
    expect(round[0].closed).toBe(true);
    expect(round[0].radius).toBeCloseTo(0.004, 6);
  });
});

describe("measuring like Onshape", () => {
  it("one face, one edge, one point", () => {
    const { pos, idx } = cylinder(0.004, 0.02);
    const t = topology(pos, idx);
    const side = t.faces.find((f) => f.kind === "cylinder")!;
    expect(measure([placeFace(side, pos, idx, I, "Pin")]).rows[0]).toEqual({ label: "Diameter", value: "8.00 mm" });
    const ring = t.edges.find((e) => e.kind === "circle")!;
    expect(measure([placeEdge(ring, I, "Pin")]).rows[0]).toEqual({ label: "Diameter", value: "8.00 mm" });
    expect(measure([placePoint([0.01, 0.02, 0.003], moved(0.1, 0, 0), "Pin")]).rows.map((r) => r.value)).toEqual(["110.00 mm", "20.00 mm", "3.00 mm"]);
    // Two points have one distance: no maximum.
    expect(measure([placePoint([0, 0, 0], I, "A"), placePoint([0.003, 0.004, 0], I, "B")]).rows.map((r) => r.label)).not.toContain("Maximum distance");
  });

  it("two parallel plates: the gap exactly, the angle 0", () => {
    const { pos, idx } = box(0.1, 0.05, 0.006);
    const t = topology(pos, idx);
    const top = t.faces.find((f) => f.normal![2] > 0.5)!;
    const bottom = t.faces.find((f) => f.normal![2] < -0.5)!;
    const r = measure([placeFace(top, pos, idx, I, "A"), placeFace(bottom, pos, idx, moved(0, 0, 0.05), "B")]);
    const row = (l: string) => r.rows.find((x) => x.label === l)?.value;
    expect(row("Normal distance")).toBe("44.00 mm");
    expect(row("Minimum distance")).toBe("44.00 mm");
    expect(row("ΔZ")).toBe("44.00 mm");
    // Corner to the opposite corner: √(100² + 50² + 44²).
    expect(row("Maximum distance")).toBe("120.15 mm");
    expect(row("Angle")).toBe("0° (parallel)");
  });

  it("two holes: the distance between their centres", () => {
    const { pos, idx } = cylinder(0.004, 0.02);
    const side = topology(pos, idx).faces.find((f) => f.kind === "cylinder")!;
    const r = measure([placeFace(side, pos, idx, I, "A"), placeFace(side, pos, idx, moved(0.03, 0.04, 0), "B")]);
    expect(r.rows.find((x) => x.label === "Centre distance")?.value).toBe("50.00 mm");
  });

  it("a face against a side face: 90°", () => {
    const { pos, idx } = box(0.1, 0.05, 0.006);
    const t = topology(pos, idx);
    const top = t.faces.find((f) => f.normal![2] > 0.5)!;
    const side = t.faces.find((f) => f.normal![0] > 0.5)!;
    expect(measure([placeFace(top, pos, idx, I, "A"), placeFace(side, pos, idx, I, "A")]).rows.find((x) => x.label === "Angle")?.value).toBe("90.00°");
  });
});
