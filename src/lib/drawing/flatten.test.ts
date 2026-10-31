import { expect, it } from "vitest";
import { loopEntities, writeDxf } from "./dxf";
import { flattenMesh, mul4, rotateZ4, translate4, type P2, type P3 } from "./flatten";

// A synthetic 120 × 50 × 6 plate with a Ø10 hole at (30, 25): through, or a 3 mm deep pocket
// from the top. Facets are wound outward, as Onshape's are.
function plate(pocket: boolean) {
  const pts: P3[] = [];
  const idx: number[] = [];
  const add = (a: P3, b: P3, c: P3, want: P3) => {
    const n = cross(sub(b, a), sub(c, a));
    const tri = n[0] * want[0] + n[1] * want[1] + n[2] * want[2] > 0 ? [a, b, c] : [a, c, b];
    for (const p of tri) idx.push(pts.push(p) - 1);
  };
  const [W, H, T, cx, cy, r] = [120, 50, 6, 30, 25, 5];
  const corners = [Math.atan2(-cy, -cx), Math.atan2(-cy, W - cx), Math.atan2(H - cy, W - cx), Math.atan2(H - cy, -cx)];
  const angles = [...Array.from({ length: 24 }, (_, k) => -Math.PI + (k * 2 * Math.PI) / 24), ...corners].sort((a, b) => a - b);
  const ray = (t: number): P2 => {
    const [dx, dy] = [Math.cos(t), Math.sin(t)];
    const s = Math.min(dx > 0 ? (W - cx) / dx : dx < 0 ? -cx / dx : Infinity, dy > 0 ? (H - cy) / dy : dy < 0 ? -cy / dy : Infinity);
    return [cx + dx * s, cy + dy * s];
  };
  const outer = angles.map(ray);
  const hole = angles.map((t): P2 => [cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  const m = angles.length;
  const at = (p: P2, z: number): P3 => [p[0], p[1], z];
  for (let k = 0; k < m; k++) {
    const k1 = (k + 1) % m;
    for (const [z, want] of [[0, [0, 0, -1]], [T, [0, 0, 1]]] as const) {
      add(at(outer[k], z), at(outer[k1], z), at(hole[k1], z), want as P3);
      add(at(outer[k], z), at(hole[k1], z), at(hole[k], z), want as P3);
    }
    const out: P3 = [outer[k][0] - cx, outer[k][1] - cy, 0];
    add(at(outer[k], 0), at(outer[k1], 0), at(outer[k1], T), out);
    add(at(outer[k], 0), at(outer[k1], T), at(outer[k], T), out);
    const inward: P3 = [cx - hole[k][0], cy - hole[k][1], 0];
    const z0 = pocket ? T / 2 : 0;
    add(at(hole[k], z0), at(hole[k1], z0), at(hole[k1], T), inward);
    add(at(hole[k], z0), at(hole[k1], T), at(hole[k], T), inward);
    if (pocket) {
      add(at([cx, cy], 0), at(hole[k], 0), at(hole[k1], 0), [0, 0, -1]); // back face under the pocket
      add(at([cx, cy], T / 2), at(hole[k], T / 2), at(hole[k1], T / 2), [0, 0, 1]); // its floor
    }
  }
  return { pts, idx };
}
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Tilted at an odd angle in the robot, optionally upside down, then in metres like the .obm file.
function tilt(pts: P3[], idx: number[], upsideDown: boolean) {
  const rot = mul4(translate4(212, -80, 431), mul4(rotX(37), mul4(rotateZ4(23), upsideDown ? rotX(180) : rotX(0))));
  const moved = pts.map((p) => apply(rot, p));
  return { positions: Float32Array.from(moved.flat().map((x) => x / 1000)), indices: Uint32Array.from(idx), moved };
}
function rotX(deg: number) {
  const r = (deg * Math.PI) / 180;
  return [1, 0, 0, 0, 0, Math.cos(r), -Math.sin(r), 0, 0, Math.sin(r), Math.cos(r), 0, 0, 0, 0, 1];
}
const apply = (m: number[], p: P3): P3 => [0, 1, 2].map((r) => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3]) as P3;
const det3 = (m: number[]) =>
  m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);

it("lays a tilted through-hole plate flat and writes its hole as a circle", () => {
  const { pts, idx } = plate(false);
  const { positions, indices, moved } = tilt(pts, idx, false);
  const flat = flattenMesh(positions, indices)!;
  expect(flat.thickness).toBeCloseTo(6, 2);
  expect(flat.size[0]).toBeCloseTo(120, 2);
  expect(flat.size[1]).toBeCloseTo(50, 2);
  expect(det3(flat.matrix)).toBeCloseTo(1, 6);
  for (const p of moved) {
    const q = apply(flat.matrix, p);
    expect(q[2]).toBeGreaterThan(-0.01);
    expect(q[2]).toBeLessThan(6.01);
  }
  expect(flat.loops.map((l) => l.hole)).toEqual([false, true]);
  const entities = flat.loops.flatMap((l) => loopEntities(l.pts));
  const circles = entities.filter((e) => e.type === "circle");
  expect(circles).toHaveLength(1);
  expect(circles[0].type === "circle" && circles[0].r).toBeCloseTo(5, 2);
  expect(entities.filter((e) => e.type === "line")).toHaveLength(4);
  const dxf = writeDxf(flat.loops.map((l) => l.pts));
  expect(dxf).toContain("AC1009");
  expect(dxf.trim().endsWith("EOF")).toBe(true);
});

it("turns an upside-down pocketed plate so the pocket faces up, never mirrored", () => {
  const { pts, idx } = plate(true);
  const { positions, indices, moved } = tilt(pts, idx, true);
  const flat = flattenMesh(positions, indices)!;
  expect(det3(flat.matrix)).toBeCloseTo(1, 6);
  // The pocket floor (originally z = 3 under the top) lands at z = 3 above the back face.
  const floor = apply(flat.matrix, moved[pts.findIndex((p) => p[0] === 30 && p[1] === 25 && p[2] === 3)]);
  expect(floor[2]).toBeCloseTo(3, 2);
  const back = apply(flat.matrix, moved[pts.findIndex((p) => p[0] === 30 && p[1] === 25 && p[2] === 0)]);
  expect(back[2]).toBeCloseTo(0, 2);
  // Only the outline is cut; the pocket isn't.
  expect(flat.loops).toHaveLength(1);
});

it("fits arcs to a rounded corner", () => {
  const loop: P2[] = [[0, 0], [100, 0]];
  for (let k = 0; k <= 9; k++) {
    const t = (k * Math.PI) / 18; // 0..90° in 10° steps, radius 10 around (100, 10)
    loop.push([100 + 10 * Math.sin(t), 10 - 10 * Math.cos(t)]);
  }
  loop.push([110, 50], [0, 50]);
  const entities = loopEntities(loop);
  const arcs = entities.filter((e) => e.type === "arc");
  expect(arcs).toHaveLength(1);
  expect(arcs[0].type === "arc" && arcs[0].r).toBeCloseTo(10, 3);
  expect(entities.filter((e) => e.type === "line")).toHaveLength(4);
});
