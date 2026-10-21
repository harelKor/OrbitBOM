// Team 1690's machines, copied from FRCBOM (ref §4). Edit here; there is no settings UI.

export type MachineStage = "Process" | "PreProcess";

// The file a machine needs: the CAD export format, a drawing link (PDF), or nothing.
export type CadFormat = "STEP" | "STL" | "DXF" | "GLTF" | "PARASOLID" | "PDF" | "NONE";

export type MachineDef = {
  id: string;
  name: string;
  stage: MachineStage;
  cadFormat: CadFormat;
  // What a cutting machine takes for an Onshape sheet metal part: its flat pattern.
  sheetFormat?: "DXF_FLAT" | "STEP_FLAT";
};

export const MACHINES = [
  { id: "hadasas", name: "HadasaS", stage: "Process", cadFormat: "STEP", sheetFormat: "STEP_FLAT" },
  { id: "laser", name: "Laser", stage: "Process", cadFormat: "STEP", sheetFormat: "DXF_FLAT" },
  { id: "manual-mill", name: "Manual Mill", stage: "Process", cadFormat: "PDF" },
  { id: "3d-pcbway", name: "3D Print - PCBway", stage: "Process", cadFormat: "STL" },
  { id: "bending", name: "Bending", stage: "Process", cadFormat: "PARASOLID" },
  { id: "countersunk", name: "Countersunk", stage: "Process", cadFormat: "PDF" },
  { id: "lathe", name: "LATHE", stage: "Process", cadFormat: "PDF" },
  { id: "cnc", name: "CNC", stage: "Process", cadFormat: "STEP", sheetFormat: "STEP_FLAT" },
  { id: "zivudim", name: "Zivudim", stage: "Process", cadFormat: "PARASOLID" },
  { id: "3d-bambu", name: "3D Print - Bambu", stage: "Process", cadFormat: "STL" },
  { id: "3d-markforged", name: "3D Print - Markforged", stage: "Process", cadFormat: "STL" },
  { id: "3d-aran", name: "3D Print - ARAN", stage: "Process", cadFormat: "STL" },
  { id: "beth-el", name: "Beth El", stage: "Process", cadFormat: "PARASOLID" },
] as const satisfies readonly MachineDef[];

export type MachineId = (typeof MACHINES)[number]["id"];

const byId = new Map<string, MachineDef>(MACHINES.map((m) => [m.id, m]));
const byName = new Map<string, MachineDef>(MACHINES.map((m) => [m.name.toLowerCase(), m]));

export function getMachine(id: string): MachineDef | undefined {
  return byId.get(id);
}

// Onshape custom properties hold the machine's display name; match it case-insensitively.
export function findMachineByName(name: string): MachineDef | undefined {
  return byName.get(name.trim().toLowerCase());
}
