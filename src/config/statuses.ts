import { getMachine, type MachineKind } from "./machines";

// Team 1690's part statuses, copied from FRCBOM (ref §4). Edit here; there is no settings UI.
// Order matters: it is the Kanban column order and the status-bar order.

export type StatusKind = "not_started" | "design" | "derived";

export type StatusDef = {
  name: string;
  color: string;
  kind: StatusKind;
  done?: boolean;
};

export const STATUSES = [
  { name: "Not Started", color: "#cbd5e1", kind: "not_started" },
  { name: "Released", color: "#00aaff", kind: "design" },
  { name: "Gcoded", color: "#8c00ff", kind: "design" },
  { name: "In Process 1", color: "#0004ff", kind: "design" },
  { name: "Ready for Process 2", color: "#00ffff", kind: "design" },
  { name: "Post Processing", color: "#f302f7", kind: "design" },
  // Only for parts made at a Factory Fab factory (FACTORY_STATUSES below).
  { name: "In Factory", color: "#10b981", kind: "design" },
  { name: "Ready for QA", color: "#fbff00", kind: "design", done: true },
  { name: "Secondary Production", color: "#ff7b00", kind: "design" },
  { name: "Reproduction", color: "#ff0000", kind: "design" },
  { name: "In Stock", color: "#04ff00", kind: "design", done: true },
  { name: "Spare Production", color: "#00ffb3", kind: "design" },
  { name: "In Spare Stock", color: "#00ff04", kind: "design", done: true },
] as const satisfies readonly StatusDef[];

export type StatusName = (typeof STATUSES)[number]["name"];

export const DEFAULT_STATUS: StatusName = "Not Started";

// Statuses 1690 dropped for shop parts (2026-10-24). Parts still stored with them read as these.
export const LEGACY_STATUSES: Record<string, StatusName> = { Ordered: "Released", "Build In Queue": "Released" };

// Status shown once a fabrication counter has moved. FRCBOM derives a built-in status from the
// first unfinished process slot and, because 1690 hides the built-ins, remaps it to the nearest
// visible status. The remap below is our reading of that behaviour (ref §4).
export const DERIVED_STATUS = {
  preprocess: "In Process 1",
  process1: "In Process 1",
  process2: "Ready for Process 2",
  done: "Ready for QA",
} as const satisfies Record<string, StatusName>;

// A Factory Fab factory's parts (Zivudim, Beth El, ARAN, PCBway) use only these (Harel,
// 2026-11-04). A status they carry from before reads as the nearest of them (computeStatus).
export const FACTORY_STATUSES = ["Not Started", "Released", "In Factory", "Ready for QA", "In Stock"] as const satisfies readonly StatusName[];
export const IN_FACTORY: StatusName = "In Factory";
const FACTORY_EQUIVALENT: Partial<Record<StatusName, StatusName>> = { Gcoded: "Released", "In Spare Stock": "In Stock" };
export const toFactoryStatus = (s: StatusName): StatusName =>
  (FACTORY_STATUSES as readonly string[]).includes(s) ? s : (FACTORY_EQUIVALENT[s] ?? IN_FACTORY);
export const isFactoryStatus = (s: string) => (FACTORY_STATUSES as readonly string[]).includes(s);

// The team's 3D printers' parts use only these (Harel, 2026-11-04). Gcoded and In Process 1 read
// as Sliced and Printing there (MACHINE_STATUS_LABELS); a status they carry from before reads as
// the nearest of them (computeStatus).
export const PRINT_STATUSES = ["Not Started", "Released", "Gcoded", "In Process 1", "Ready for QA", "In Stock", "Reproduction"] as const satisfies readonly StatusName[];
const PRINT_EQUIVALENT: Partial<Record<StatusName, StatusName>> = {
  "Ready for Process 2": "In Process 1",
  "Post Processing": "Ready for QA",
  "In Factory": "In Process 1",
  "Secondary Production": "Reproduction",
  "Spare Production": "Reproduction",
  "In Spare Stock": "In Stock",
};
export const toPrintStatus = (s: StatusName): StatusName => ((PRINT_STATUSES as readonly string[]).includes(s) ? s : (PRINT_EQUIVALENT[s] ?? "Released"));
export const isPrintStatus = (s: string) => (PRINT_STATUSES as readonly string[]).includes(s);

export const DONE_STATUSES: StatusName[] = STATUSES.filter((s) => "done" in s && s.done).map(
  (s) => s.name,
);

const byName = new Map<string, StatusDef>(STATUSES.map((s) => [s.name, s]));

export function getStatus(name: string): StatusDef | undefined {
  return byName.get(name);
}

export function isStatusName(name: string): name is StatusName {
  return byName.has(name);
}

// What a status is called at the machine doing the work: a part printing on the Bambu is
// "Printing", not "In Process 1". Only the name changes; the status, its colour and its place in
// the order stay the same, so stats, filters and To Fab work as before.
export const MACHINE_STATUS_LABELS: Record<MachineKind, Partial<Record<StatusName, string>>> = {
  print: { Gcoded: "Sliced", "In Process 1": "Printing" },
  laser: { "In Process 1": "Cutting" },
  machining: { "In Process 1": "Machining" },
  bending: { "In Process 1": "Bending" },
  countersink: { "In Process 1": "Countersinking" },
  factory: { "In Process 1": "At Factory" },
};

export function statusLabel(status: string, machineId?: string | null): string {
  const kind = machineId ? getMachine(machineId)?.kind : undefined;
  return (kind && MACHINE_STATUS_LABELS[kind][status as StatusName]) || status;
}
