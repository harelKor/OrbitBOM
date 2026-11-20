import { machineName } from "@/config/machines";
import { machinesOf } from "@/lib/fab";

// Checks on a part's data that warn but never block (audit 2026-11-20, Harel): the To Review page
// lists them and the part's card carries a badge.

type TypeInput = {
  classification: string;
  material: string | null;
  inventoryItemId: string | null;
  process1: string | null;
  addedProcesses: { machine: string }[] | null;
};

// A COTS-typed part that is really made: cut from Raw Stock, or with a machine process (CNC,
// laser, a printer, the shop). A part bought as its Process 1 and then machined is In-house with
// COTS as Process 1, and is fine.
export function cotsTypeProblem(part: TypeInput, rawStock: { ids: Set<string>; names: Set<string> }): string | null {
  if (part.classification !== "cots") return null;
  const made = machinesOf({ process1: part.process1, addedProcesses: part.addedProcesses ?? [] });
  if (made.length) return `Typed COTS but made on ${made.map(machineName).join(", ")}: make it In-house (with COTS as Process 1 if it is bought first).`;
  const raw = (part.inventoryItemId && rawStock.ids.has(part.inventoryItemId)) || (part.material && rawStock.names.has(part.material));
  if (raw) return `Typed COTS but cut from raw stock (${part.material}): make it In-house.`;
  return null;
}

// What a part number collision goes by: Onshape's part number, else the Onshape name (the team
// names parts by their number, 1690-26-421-01).
export const numberOf = (p: { partNumber?: string | null; onshapeName?: string | null }) => (p.partNumber?.trim() || p.onshapeName?.trim() || null);

// The part numbers worn by two or more different shapes (shape fingerprints, versions/shape.ts):
// Name collision. A part with no fingerprint isn't compared.
export function collidingNumbers<T>(list: T[], number: (t: T) => string | null, sig: (t: T) => string | null | undefined): Set<string> {
  const shapes = new Map<string, Set<string>>();
  for (const t of list) {
    const n = number(t);
    const s = sig(t);
    if (!n || !s) continue;
    shapes.set(n, (shapes.get(n) ?? new Set()).add(s));
  }
  return new Set([...shapes].filter(([, s]) => s.size > 1).map(([n]) => n));
}
