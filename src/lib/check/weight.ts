import { densityOf, GUESS_DENSITY, PRINTED_SHARE } from "./density";
import type { WeightPart, WeightResult, WeightSource } from "./types";

// A closed mesh's volume (the sum of the signed tetrahedra from the origin), in the mesh's units
// cubed. The model's meshes are in metres, so cm³ = m³ × 1e6.
export function meshVolume(positions: ArrayLike<number>, index: ArrayLike<number>): number {
  let v = 0;
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(v) / 6;
}

// What the database knows about a part (by its BOM key): its materials, whether a printer makes
// it, and a weight set by hand (grams, one copy).
export type PartFacts = { material: string | null; onshapeMaterial: string | null; printed: boolean; setG: number | null };

// The model's parts as placed: one row per (part, system) with how many copies and one copy's volume.
export type WeighInput = { key: string; name: string; systemId: string | null; count: number; volumeCm3: number };

export function weighOne(volumeCm3: number, facts: PartFacts | undefined): { g: number; source: WeightSource; material: string | null } {
  if (facts?.setG != null) return { g: facts.setG, source: "set", material: facts.material ?? facts.onshapeMaterial };
  const material = facts?.onshapeMaterial ?? facts?.material ?? null;
  const d = densityOf(facts?.onshapeMaterial, facts?.material);
  if (d == null) return { g: volumeCm3 * GUESS_DENSITY, source: "guess", material };
  if (facts?.printed) return { g: volumeCm3 * d * PRINTED_SHARE, source: "printed", material };
  return { g: volumeCm3 * d, source: "material", material };
}

export function weigh(items: WeighInput[], facts: Map<string, PartFacts>): WeightResult {
  const parts: WeightPart[] = items.map((it) => {
    const w = weighOne(it.volumeCm3, facts.get(it.key));
    return { key: it.key, name: it.name, systemId: it.systemId, count: it.count, eachG: round1(w.g), source: w.source, material: w.material, cm3: round1(it.volumeCm3) };
  });
  return total(parts);
}

// A saved run's weights again after a part's weight was set (grams) or cleared (null): the page
// shows the new totals at once, without running the check again.
export function reweigh(result: WeightResult, key: string, grams: number | null, facts: PartFacts | undefined): WeightResult {
  const parts = result.parts.map((p) => {
    if (p.key !== key) return p;
    const w = weighOne(p.cm3, { material: facts?.material ?? null, onshapeMaterial: facts?.onshapeMaterial ?? null, printed: facts?.printed ?? false, setG: grams });
    return { ...p, eachG: round1(w.g), source: w.source };
  });
  return total(parts);
}

function total(parts: WeightPart[]): WeightResult {
  parts.sort((a, b) => b.eachG * b.count - a.eachG * a.count);
  const by = new Map<string | null, number>();
  let totalG = 0;
  for (const p of parts) {
    const g = p.eachG * p.count;
    totalG += g;
    by.set(p.systemId, (by.get(p.systemId) ?? 0) + g);
  }
  const bySystem = [...by].map(([systemId, g]) => ({ systemId, g: Math.round(g) })).sort((a, b) => b.g - a.g);
  return { totalG: Math.round(totalG), bySystem, parts };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
