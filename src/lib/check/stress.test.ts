import { describe, expect, it } from "vitest";
import type { Loop } from "./plates";
import { DEFAULT_MATERIAL, materialOf, solveStress } from "./stress";

const ring = (cx: number, cy: number, r: number): Loop => ({
  pts: Array.from({ length: 32 }, (_, i) => [cx + r * Math.cos((-i * 2 * Math.PI) / 32), cy + r * Math.sin((-i * 2 * Math.PI) / 32)] as [number, number]),
  area: Math.PI * r * r,
  circle: { cx, cy, r },
});
const rect = (w: number, h: number): Loop => ({ pts: [[0, 0], [w, 0], [w, h], [0, h]], area: w * h, circle: null });

describe("plate stress", () => {
  // A 220 × 40 × 5 mm aluminium bar bolted at its left end by two holes, pulled down 100 N by a
  // pin at its right end: a cantilever. Beam theory at the inner bolt: M = 100 × 170 N·mm,
  // σ = 6M / (t·H²) = 12.75 MPa, more round the bolt holes.
  const plate = { outer: rect(220, 40), inner: [ring(10, 20, 3), ring(30, 20, 3), ring(210, 20, 3)], t: 5 };
  it("finds the cantilever's stress near the bolts, the size beam theory gives", async () => {
    const r = await solveStress({ plate, held: [0, 1], load: { hole: 2, N: 100, deg: -90 }, material: DEFAULT_MATERIAL, maxCells: 4000 });
    expect(r.converged).toBe(true);
    expect(r.max).toBeGreaterThan(10);
    expect(r.max).toBeLessThan(45);
    expect(r.at[0]).toBeLessThan(60);
    // Tip deflection: PL³/3EI with L = 177 mm, I = tH³/12 is about 0.10 mm; shear and the
    // bolt holes give a little more.
    expect(r.dispMax).toBeGreaterThan(0.08);
    expect(r.dispMax).toBeLessThan(0.4);
    expect(r.safety).toBeCloseTo(276 / r.max);
  });

  it("knows the usual materials' strength", () => {
    expect(materialOf("Aluminum - 7075")?.yield).toBe(503);
    expect(materialOf("6061 Aluminum Plate")?.name).toBe("6061-T6 aluminium");
    expect(materialOf("Polycarbonate 1/8")?.E).toBe(2400);
    expect(materialOf("mystery")).toBeNull();
  });
});
