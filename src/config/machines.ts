// Team 1690's machines, copied from FRCBOM (ref §4). Edit here; there is no settings UI.

export type MachineStage = "Process" | "PreProcess";

// The file a machine needs: the CAD export format, a drawing link (PDF), or nothing.
export type CadFormat = "STEP" | "STL" | "DXF" | "GLTF" | "PARASOLID" | "PDF" | "NONE";

// What kind of work the machine does; it names the part's statuses there (src/config/statuses.ts).
// A "factory" is a partner outside the team: parts sent there are tagged In factory.
export type MachineKind = "print" | "laser" | "machining" | "bending" | "countersink" | "factory";

export type MachineDef = {
  id: string;
  name: string;
  stage: MachineStage;
  kind: MachineKind;
  cadFormat: CadFormat;
  // What a cutting machine takes for an Onshape sheet metal part: its flat pattern.
  sheetFormat?: "DXF_FLAT" | "STEP_FLAT";
  // A partner factory with its own Factory Fab page: its parts take the factory statuses
  // (src/config/statuses.ts) and leave To Fab (Harel, 2026-11-04).
  factoryFab?: boolean;
  // Factory Fab packs its Released parts by itself, one pack per material (Harel, 2026-11-04).
  packsByMaterial?: boolean;
};

export const MACHINES = [
  { id: "hadasas", kind: "factory", name: "Hadasa", stage: "Process", cadFormat: "STEP", sheetFormat: "STEP_FLAT" },
  { id: "laser", kind: "laser", name: "Laser", stage: "Process", cadFormat: "DXF", sheetFormat: "DXF_FLAT" },
  { id: "manual-mill", kind: "machining", name: "Manual Mill", stage: "Process", cadFormat: "PDF" },
  { id: "3d-pcbway", kind: "print", name: "3D Print - PCBway", stage: "Process", cadFormat: "STL", factoryFab: true },
  { id: "bending", kind: "bending", name: "Bending", stage: "Process", cadFormat: "PARASOLID" },
  { id: "countersunk", kind: "countersink", name: "Countersunk", stage: "Process", cadFormat: "PDF" },
  { id: "lathe", kind: "machining", name: "LATHE", stage: "Process", cadFormat: "PDF" },
  { id: "cnc", kind: "machining", name: "CNC", stage: "Process", cadFormat: "STEP", sheetFormat: "STEP_FLAT" },
  { id: "zivudim", kind: "factory", name: "Zivudim", stage: "Process", cadFormat: "PARASOLID", factoryFab: true, packsByMaterial: true },
  { id: "3d-bambu", kind: "print", name: "Bambu", stage: "Process", cadFormat: "STL" },
  { id: "3d-markforged", kind: "print", name: "3D Print - Markforged", stage: "Process", cadFormat: "STL" },
  { id: "3d-h2d", kind: "print", name: "H2D", stage: "Process", cadFormat: "STL" },
  { id: "3d-aran", kind: "print", name: "3D Print - ARAN", stage: "Process", cadFormat: "STL", factoryFab: true },
  { id: "beth-el", kind: "factory", name: "Beth El", stage: "Process", cadFormat: "PARASOLID", factoryFab: true },
] as const satisfies readonly MachineDef[];

export type MachineId = (typeof MACHINES)[number]["id"];

const byId = new Map<string, MachineDef>(MACHINES.map((m) => [m.id, m]));
const byName = new Map<string, MachineDef>(MACHINES.map((m) => [m.name.toLowerCase(), m]));
// Hadasa was "HadasaS" until 2026-11-04; Onshape properties may still say so.
byName.set("hadasas", byId.get("hadasas")!);

export function getMachine(id: string): MachineDef | undefined {
  return byId.get(id);
}

// Parts with any of these machines are made outside the team (Zivudim, Hadasa, Beth El, ARAN,
// PCBway): their cards are tagged In factory.
export const isFactoryMachine = (id: string | null | undefined) => !!id && (getMachine(id)?.kind === "factory" || !!getMachine(id)?.factoryFab);

// The factories with a Factory Fab page. Hadasa is tagged In factory but is worked like an
// in-house machine: To Fab and the usual statuses (Harel, 2026-11-04).
export const FACTORY_FAB_MACHINES = MACHINES.filter((m): m is Extract<(typeof MACHINES)[number], { factoryFab: true }> => "factoryFab" in m && m.factoryFab);
export const packsByMaterial = (id: string | null | undefined) => !!id && !!getMachine(id)?.packsByMaterial;
export const isFactoryFabMachine = (id: string | null | undefined) => !!id && !!getMachine(id)?.factoryFab;

// The Factory Fab factory a part goes to (its first such process), or null.
export const factoryOf = (part: { preProcess: string | null; process1: string | null; process2: string | null }) =>
  [part.preProcess, part.process1, part.process2].find(isFactoryFabMachine) ?? null;

// The team's own 3D printers (Bambu, Markforged, H2D), each with a 3D Printing page; ARAN and
// PCBway print too but are factories (Harel, 2026-11-04).
export const PRINTERS = MACHINES.filter((m) => m.kind === "print" && !("factoryFab" in m && m.factoryFab));
export const isPrinter = (id: string | null | undefined) => !!id && getMachine(id)?.kind === "print" && !getMachine(id)?.factoryFab;

// The printer a part is made on (its first), unless a factory makes it.
export const printerOf = (part: { preProcess: string | null; process1: string | null; process2: string | null }) =>
  factoryOf(part) ? null : ([part.preProcess, part.process1, part.process2].find(isPrinter) ?? null);

// The pages a part's work is on besides Shop Fab: a factory's (Factory Fab) or a printer's (3D Printing).
export type FabArea = "factory" | "print";
export const areaOf = (part: { preProcess: string | null; process1: string | null; process2: string | null }): FabArea | null =>
  factoryOf(part) ? "factory" : printerOf(part) ? "print" : null;
export const areaOfMachine = (id: string | null | undefined): FabArea | null => (isFactoryFabMachine(id) ? "factory" : isPrinter(id) ? "print" : null);

// Onshape custom properties hold the machine's display name; match it case-insensitively.
export function findMachineByName(name: string): MachineDef | undefined {
  return byName.get(name.trim().toLowerCase());
}
