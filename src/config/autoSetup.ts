// What Suggest setup on To Review picks for a part's processes when the team hasn't made two or
// more parts of that material yet. Keys are a word in the material's inventory item ("PLA" in
// "Bambu PLA – Black filament") or, failing that, its inventory category id; values are machine
// ids from machines.ts. Edit here; there is no settings UI.
// Once the team has set processes on parts of a material by hand, the most common choice wins.

export type ProcessSet = { preProcess?: string; process1?: string; process2?: string };

export const DEFAULT_PROCESSES: Record<string, ProcessSet> = {
  "aluminum-plates": { process1: "cnc" },
  polycarbonate: { process1: "laser" },
  PLA: { process1: "3d-bambu" },
  PA612: { process1: "3d-bambu" },
  Onyx: { process1: "3d-markforged" },
  SLS: { process1: "3d-pcbway" },
};

// How close a part's measured thickness must be to a plate's, in mm.
export const PLATE_TOLERANCE_MM = 0.15;

// The process a bent plate (Onshape sheet metal, or a bent thin wall) gets after it is cut.
export const BENDING_MACHINE = "bending";

// Set on a part as soon as it comes from Onshape (Update BOM), when Onshape's material names one
// of these and the part has no processes yet (Harel, 2026-10-31): it's made in-house on that
// machine, from the filament item of that material when inventory has one.
export const IMPORT_BY_MATERIAL: { match: RegExp; material: string; process1: string }[] = [
  { match: /\bpla\b/i, material: "PLA", process1: "3d-bambu" },
];

export function importSetup(...materials: (string | null | undefined)[]) {
  return IMPORT_BY_MATERIAL.find((r) => materials.some((m) => m && r.match.test(m)));
}
