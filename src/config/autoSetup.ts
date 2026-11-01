// What Suggest setup on To Review picks for a part's processes when the team hasn't made two or
// more parts of that material yet. Keys are a word in the material's inventory item ("PLA" in
// "Bambu PLA – Black filament") or, failing that, its inventory category id; values are machine
// ids from machines.ts. Edit here; there is no settings UI.
// Once the team has set processes on parts of a material by hand, the most common choice wins,
// except where the part's shape decides (src/lib/review/rules.ts): 3D printed parts, pocketed
// plates (CNC), hex shafts (Manual Mill, LATHE when turned), rods, spacers and other turned parts
// (LATHE), and solid metal blocks (CNC).

export type ProcessSet = { preProcess?: string; process1?: string; process2?: string };

export const DEFAULT_PROCESSES: Record<string, ProcessSet> = {
  "aluminum-plates": { process1: "cnc" },
  polycarbonate: { process1: "laser" },
  "wood-composites": { process1: "laser" },
  "square-tubes": { process1: "laser" },
  PLA: { process1: "3d-bambu" },
  PA612: { process1: "3d-bambu" },
  Onyx: { process1: "3d-markforged" },
  SLS: { process1: "3d-pcbway" },
};

// Machines Suggest setup picks from the part's shape.
export const SHAPE_MACHINES = {
  pocketedPlate: "cnc",
  hexShaft: "manual-mill",
  turned: "lathe", // rods, pins, spacers, bushings, turned hex ends, other round metal parts
  block: "cnc", // other solid metal parts
};

// 3D printing materials, by Onshape's material name: the part is printed on `machine` and nothing
// else (no pre-process, no second process), from the filament item whose name or material spec
// matches `filament`.
export const PRINT_MATERIALS: { match: RegExp; filament: RegExp; machine: string }[] = [
  { match: /\bonyx\b/i, filament: /\bonyx\b/i, machine: "3d-markforged" },
  { match: /\bpla\b/i, filament: /\bpla\b/i, machine: "3d-bambu" },
  { match: /\btpu\b/i, filament: /\btpu\b/i, machine: "3d-bambu" },
  { match: /\bpetg\b/i, filament: /\bpetg\b/i, machine: "3d-bambu" },
  { match: /\babs\b/i, filament: /\babs\b/i, machine: "3d-bambu" },
  { match: /\basa\b/i, filament: /\basa\b/i, machine: "3d-bambu" },
  { match: /\bpa ?6?12\b|nylon/i, filament: /\bpa ?6?12\b|nylon/i, machine: "3d-bambu" },
];

// How close a part's measured thickness must be to a plate's, in mm (the closest plate wins).
export const PLATE_TOLERANCE_MM = 0.25;
// How close a tube's outside size must be to an item's, and its wall, in mm.
export const TUBE_TOLERANCE_MM = 1; // an inch tube (25.4×50.8) matches the 25×50 the shop stocks
export const WALL_TOLERANCE_MM = 0.3;

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
