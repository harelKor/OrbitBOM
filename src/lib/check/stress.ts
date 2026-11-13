import type { Plate } from "./plates";

// Phase 6 of the Design check (Harel's list, 2026-11-13): a plate's stress, in the browser. The
// plate's outline (plates.ts) is laid on a grid of small squares; each square inside the material
// is a 4-node plane-stress element; holes picked as "held" are bolted down (their edge can't
// move) and one hole takes the load, pushed by a pin in one direction. Conjugate gradients solve
// it a few hundred steps at a time, pausing so the page keeps drawing. Units: mm, N, MPa.
// A sketch of where the stress goes and roughly how much, not a certified answer: the grid is
// coarse round small holes, and the plate is loaded only in its own plane.

export type Material = { name: string; E: number; nu: number; yield: number };

// Young's modulus and yield strength (MPa) by material name; first match wins.
const MATERIALS: [RegExp, Material][] = [
  [/7075/, { name: "7075-T6 aluminium", E: 71700, nu: 0.33, yield: 503 }],
  [/5052/, { name: "5052 aluminium", E: 70300, nu: 0.33, yield: 193 }],
  [/alumin|\b6061\b|\b6063\b/, { name: "6061-T6 aluminium", E: 68900, nu: 0.33, yield: 276 }],
  [/stainless/, { name: "stainless steel", E: 193000, nu: 0.29, yield: 215 }],
  [/steel|chromoly|4130|4140/, { name: "steel", E: 200000, nu: 0.29, yield: 250 }],
  [/polycarb|lexan/, { name: "polycarbonate", E: 2400, nu: 0.37, yield: 62 }],
  [/carbon/, { name: "carbon fibre", E: 70000, nu: 0.1, yield: 600 }],
  [/delrin|acetal|\bpom\b/, { name: "acetal", E: 2900, nu: 0.35, yield: 65 }],
  [/onyx/, { name: "Onyx", E: 2400, nu: 0.35, yield: 40 }],
  [/nylon|\bpa\s?6|\bpa\s?12|pa612/, { name: "nylon", E: 2700, nu: 0.39, yield: 70 }],
  [/petg/, { name: "PETG", E: 2100, nu: 0.38, yield: 50 }],
  [/\bpla\b/, { name: "PLA", E: 3500, nu: 0.36, yield: 50 }],
  [/hdpe|uhmw/, { name: "polyethylene", E: 1000, nu: 0.42, yield: 25 }],
  [/birch|plywood|wood/, { name: "plywood", E: 9000, nu: 0.3, yield: 40 }],
  [/g-?10|fr-?4|garolite/, { name: "G10", E: 18000, nu: 0.12, yield: 260 }],
];
export const DEFAULT_MATERIAL = MATERIALS[2][1];
export const MATERIAL_LIST = MATERIALS.map(([, m]) => m);

export function materialOf(...names: (string | null | undefined)[]): Material | null {
  for (const name of names) {
    if (!name) continue;
    const n = name.toLowerCase();
    for (const [re, m] of MATERIALS) if (re.test(n)) return m;
  }
  return null;
}

export type StressInput = {
  plate: Pick<Plate, "outer" | "inner" | "t">;
  held: number[]; // indices into plate.inner (round holes) bolted down
  load: { hole: number; N: number; deg: number }; // a pin in that hole pushes this way (degrees, in the plate's 2D frame)
  material: Material;
  maxCells?: number;
};

export type StressResult = {
  h: number; // grid size, mm
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  vm: Float32Array; // von Mises stress per square, row by row; NaN outside the material
  max: number; // MPa
  at: [number, number]; // where
  dispMax: number; // mm
  safety: number; // yield / max
  converged: boolean;
};

function inside(pts: [number, number][], x: number, y: number) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// The stiffness of one h × h square, thickness t (8 × 8, nodes counter-clockwise from bottom
// left, x then y per node), by 2 × 2 Gauss points.
function squareStiffness(h: number, t: number, E: number, nu: number): Float64Array {
  const k = new Float64Array(64);
  const c = E / (1 - nu * nu);
  const D = [c, c * nu, 0, c * nu, c, 0, 0, 0, (c * (1 - nu)) / 2];
  const g = 1 / Math.sqrt(3);
  const xi = [-1, 1, 1, -1];
  const eta = [-1, -1, 1, 1];
  for (const a of [-g, g]) {
    for (const b of [-g, g]) {
      const B = new Float64Array(24); // 3 × 8
      for (let i = 0; i < 4; i++) {
        const dx = ((xi[i] * (1 + eta[i] * b)) / 4) * (2 / h);
        const dy = ((eta[i] * (1 + xi[i] * a)) / 4) * (2 / h);
        B[2 * i] = dx; // εx
        B[8 + 2 * i + 1] = dy; // εy
        B[16 + 2 * i] = dy; // γxy
        B[16 + 2 * i + 1] = dx;
      }
      const w = t * (h / 2) * (h / 2);
      for (let r = 0; r < 8; r++) {
        for (let s = 0; s < 8; s++) {
          let sum = 0;
          for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) sum += B[p * 8 + r] * D[p * 3 + q] * B[q * 8 + s];
          k[r * 8 + s] += sum * w;
        }
      }
    }
  }
  return k;
}

export async function solveStress(input: StressInput, pause?: () => Promise<void>): Promise<StressResult> {
  const { plate, material } = input;
  const xs = plate.outer.pts.map((p) => p[0]);
  const ys = plate.outer.pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0;
  const hgt = Math.max(...ys) - y0;
  const h = Math.max(0.4, Math.sqrt((w * hgt) / (input.maxCells ?? 4000)));
  const nx = Math.max(1, Math.ceil(w / h));
  const ny = Math.max(1, Math.ceil(hgt / h));
  const cutouts = plate.inner.map((l) => l.pts);

  // Squares in the material, and their corner nodes.
  const solid = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const cx = x0 + (i + 0.5) * h;
      const cy = y0 + (j + 0.5) * h;
      if (inside(plate.outer.pts, cx, cy) && !cutouts.some((p) => inside(p, cx, cy))) solid[j * nx + i] = 1;
    }
  }
  const nodeOf = new Int32Array((nx + 1) * (ny + 1)).fill(-1);
  let nn = 0;
  const corners = (i: number, j: number) => [j * (nx + 1) + i, j * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i + 1, (j + 1) * (nx + 1) + i];
  const elems: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!solid[j * nx + i]) continue;
      elems.push(j * nx + i);
      for (const g of corners(i, j)) if (nodeOf[g] < 0) nodeOf[g] = nn++;
    }
  }
  const nodeXY = new Float64Array(nn * 2);
  for (let g = 0; g < nodeOf.length; g++) {
    if (nodeOf[g] < 0) continue;
    nodeXY[nodeOf[g] * 2] = x0 + (g % (nx + 1)) * h;
    nodeXY[nodeOf[g] * 2 + 1] = y0 + Math.floor(g / (nx + 1)) * h;
  }
  const conn = new Int32Array(elems.length * 4);
  elems.forEach((e, k) => corners(e % nx, Math.floor(e / nx)).forEach((g, c) => (conn[k * 4 + c] = nodeOf[g])));

  // Bolted holes: nodes on their edge don't move. The loaded hole: its edge on the side the pin
  // pushes takes the force, more where it pushes square on.
  const near = (hole: number) => {
    const c = plate.inner[hole]?.circle;
    if (!c) return [] as number[];
    const out: number[] = [];
    for (let n = 0; n < nn; n++) if (Math.hypot(nodeXY[2 * n] - c.cx, nodeXY[2 * n + 1] - c.cy) <= c.r + h * 0.9) out.push(n);
    return out;
  };
  const fixed = new Uint8Array(nn * 2);
  for (const hole of input.held) for (const n of near(hole)) fixed[2 * n] = fixed[2 * n + 1] = 1;
  const f = new Float64Array(nn * 2);
  const lc = plate.inner[input.load.hole]?.circle;
  if (lc) {
    const dx = Math.cos((input.load.deg * Math.PI) / 180);
    const dy = Math.sin((input.load.deg * Math.PI) / 180);
    const ws = near(input.load.hole).map((n) => ({ n, w: Math.max(0, ((nodeXY[2 * n] - lc.cx) * dx + (nodeXY[2 * n + 1] - lc.cy) * dy) / Math.max(1e-9, Math.hypot(nodeXY[2 * n] - lc.cx, nodeXY[2 * n + 1] - lc.cy))) }));
    const sum = ws.reduce((s, x) => s + x.w, 0);
    for (const { n, w: wt } of ws) {
      if (!sum) break;
      f[2 * n] += (input.load.N * dx * wt) / sum;
      f[2 * n + 1] += (input.load.N * dy * wt) / sum;
    }
  }

  // K·u = f by conjugate gradients, K applied square by square, Jacobi-preconditioned. Plain
  // loops over typed arrays: this runs thousands of times.
  const ke = squareStiffness(h, plate.t, material.E, material.nu);
  const dofs = nn * 2;
  const ne = elems.length;
  const dof = new Int32Array(ne * 8);
  for (let e = 0; e < ne; e++) for (let r = 0; r < 8; r++) dof[e * 8 + r] = conn[e * 4 + (r >> 1)] * 2 + (r & 1);
  const loc = new Float64Array(8);
  const Kx = (x: Float64Array, out: Float64Array) => {
    out.fill(0);
    for (let e = 0; e < ne; e++) {
      const o = e * 8;
      for (let c = 0; c < 8; c++) loc[c] = x[dof[o + c]];
      for (let r = 0; r < 8; r++) {
        const k = r * 8;
        out[dof[o + r]] += ke[k] * loc[0] + ke[k + 1] * loc[1] + ke[k + 2] * loc[2] + ke[k + 3] * loc[3] + ke[k + 4] * loc[4] + ke[k + 5] * loc[5] + ke[k + 6] * loc[6] + ke[k + 7] * loc[7];
      }
    }
    for (let d = 0; d < dofs; d++) if (fixed[d]) out[d] = x[d];
  };
  const diag = new Float64Array(dofs);
  for (let e = 0; e < ne; e++) for (let r = 0; r < 8; r++) diag[dof[e * 8 + r]] += ke[r * 8 + r];
  for (let d = 0; d < dofs; d++) if (fixed[d] || !diag[d]) diag[d] = 1;
  const u = new Float64Array(dofs);
  const r = new Float64Array(dofs);
  const z = new Float64Array(dofs);
  const p = new Float64Array(dofs);
  const Ap = new Float64Array(dofs);
  let rz = 0;
  let norm0 = 0;
  for (let d = 0; d < dofs; d++) {
    r[d] = fixed[d] ? 0 : f[d];
    z[d] = r[d] / diag[d];
    p[d] = z[d];
    rz += r[d] * z[d];
    norm0 += r[d] * r[d];
  }
  norm0 = Math.sqrt(norm0) || 1;
  let converged = false;
  const maxIter = Math.min(20000, dofs * 2);
  for (let it = 0; it < maxIter; it++) {
    Kx(p, Ap);
    let pAp = 0;
    for (let d = 0; d < dofs; d++) pAp += p[d] * Ap[d];
    if (!(pAp > 0)) break;
    const alpha = rz / pAp;
    let rr = 0;
    let rz2 = 0;
    for (let d = 0; d < dofs; d++) {
      u[d] += alpha * p[d];
      r[d] -= alpha * Ap[d];
      rr += r[d] * r[d];
      z[d] = r[d] / diag[d];
      rz2 += r[d] * z[d];
    }
    if (Math.sqrt(rr) / norm0 < 1e-6) {
      converged = true;
      break;
    }
    const beta = rz2 / rz;
    rz = rz2;
    for (let d = 0; d < dofs; d++) p[d] = z[d] + beta * p[d];
    if (pause && it % 50 === 0) await pause();
  }

  // Von Mises in the middle of each square.
  const c = material.E / (1 - material.nu * material.nu);
  const vm = new Float32Array(nx * ny).fill(NaN);
  let max = 0;
  let at: [number, number] = [0, 0];
  for (let e = 0; e < elems.length; e++) {
    const q = (k: number, a: 0 | 1) => u[conn[e * 4 + k] * 2 + a];
    // Bilinear square at its middle: averages of the side differences.
    const ex = (q(1, 0) - q(0, 0) + q(2, 0) - q(3, 0)) / (2 * h);
    const ey = (q(3, 1) - q(0, 1) + q(2, 1) - q(1, 1)) / (2 * h);
    const gxy = (q(3, 0) - q(0, 0) + q(2, 0) - q(1, 0)) / (2 * h) + (q(1, 1) - q(0, 1) + q(2, 1) - q(3, 1)) / (2 * h);
    const sx = c * (ex + material.nu * ey);
    const sy = c * (ey + material.nu * ex);
    const txy = ((c * (1 - material.nu)) / 2) * gxy;
    const v = Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * txy * txy);
    vm[elems[e]] = v;
    if (v > max) {
      max = v;
      at = [x0 + ((elems[e] % nx) + 0.5) * h, y0 + (Math.floor(elems[e] / nx) + 0.5) * h];
    }
  }
  let dispMax = 0;
  for (let n = 0; n < nn; n++) dispMax = Math.max(dispMax, Math.hypot(u[2 * n], u[2 * n + 1]));
  return { h, x0, y0, nx, ny, vm, max, at, dispMax, safety: max ? material.yield / max : Infinity, converged };
}
