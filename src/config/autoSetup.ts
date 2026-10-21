// What Suggest setup on To Review picks for a part's processes when the team hasn't made two or
// more parts of that material yet. Keys are a material name or, failing that, its category in
// materials.ts; values are machine ids from machines.ts. Edit here; there is no settings UI.
// Once the team has set processes on parts of a material by hand, the most common choice wins.

export type ProcessSet = { preProcess?: string; process1?: string; process2?: string };

export const DEFAULT_PROCESSES: Record<string, ProcessSet> = {
  "Aluminum Plates": { process1: "cnc" },
  "Polycarbonate Plates": { process1: "laser" },
  PLA: { process1: "3d-bambu" },
  PA612: { process1: "3d-bambu" },
  Onyx: { process1: "3d-markforged" },
  SLS: { process1: "3d-pcbway" },
};

// How close a part's measured thickness must be to a plate's, in mm.
export const PLATE_TOLERANCE_MM = 0.15;

// The process a bent plate (Onshape sheet metal, or a bent thin wall) gets after it is cut.
export const BENDING_MACHINE = "bending";
