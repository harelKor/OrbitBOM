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
  // A part with added processes (Process 2, 3...) after Process 1: released to its next process,
  // then being worked there. One status each for every process after the first; the part shows
  // its own number ("Released P3", "In Process 3"), the Kanban, filters and stats group them
  // (Harel, 2026-11-20). "Released P2+" replaces "Ready for Process 2".
  { name: "Released P2+", color: "#00ffff", kind: "design" },
  { name: "In Process 2+", color: "#3b82f6", kind: "design" },
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
export const LEGACY_STATUSES: Record<string, StatusName> = { Ordered: "Released", "Build In Queue": "Released", "Ready for Process 2": "Released P2+" };

export const RELEASED_LATER: StatusName = "Released P2+";
export const IN_PROCESS_LATER: StatusName = "In Process 2+";
export const READY_FOR_QA: StatusName = "Ready for QA";

// "Released P3" / "In Process 3" (and the old "Ready for Process 2"): the group and the process
// number, or null for any other status.
export function processStatusOf(name: string | null | undefined): { group: StatusName; n: number } | null {
  if (!name) return null;
  if (name === "Ready for Process 2") return { group: RELEASED_LATER, n: 2 };
  const m = /^(?:Released P|In Process )(\d+)\+?$/.exec(name);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 2 || n > 99) return null;
  return { group: name.startsWith("Released") ? RELEASED_LATER : IN_PROCESS_LATER, n };
}

// The name a grouped status has at process n: "Released P3", "In Process 3".
export const processStatusName = (group: StatusName, n: number): string =>
  group === RELEASED_LATER ? `Released P${n}` : group === IN_PROCESS_LATER ? `In Process ${n}` : group;

// A Factory Fab factory's parts (Zivudim, Beth El, ARAN, PCBway) use only these (Harel,
// 2026-11-04). A status they carry from before reads as the nearest of them (computeStatus).
export const FACTORY_STATUSES = ["Not Started", "Released", "In Factory", "Ready for QA", "In Stock"] as const satisfies readonly StatusName[];
export const IN_FACTORY: StatusName = "In Factory";
// A part at a factory for its second or later process is Released / In Factory there.
const FACTORY_EQUIVALENT: Partial<Record<StatusName, StatusName>> = { Gcoded: "Released", "In Spare Stock": "In Stock", "Released P2+": "Released", "In Process 2+": "In Factory" };
export const toFactoryStatus = (s: StatusName): StatusName =>
  (FACTORY_STATUSES as readonly string[]).includes(s) ? s : (FACTORY_EQUIVALENT[s] ?? IN_FACTORY);
export const isFactoryStatus = (s: string) => (FACTORY_STATUSES as readonly string[]).includes(s);

// The team's 3D printers' parts use only these (Harel, 2026-11-04). Gcoded and In Process 1 read
// as Sliced and Printing there (MACHINE_STATUS_LABELS); a status they carry from before reads as
// the nearest of them (computeStatus).
export const PRINT_STATUSES = ["Not Started", "Released", "Gcoded", "In Process 1", "Ready for QA", "In Stock", "Reproduction"] as const satisfies readonly StatusName[];
const PRINT_EQUIVALENT: Partial<Record<StatusName, StatusName>> = {
  "Released P2+": "Released",
  "In Process 2+": "In Process 1",
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

// A status a member may pick: one of the list, or a numbered one ("Released P3", "In Process 4").
// Released P2+ / In Process 2+ themselves aren't: a part takes its own number.
export const isPickableStatus = (name: string) => (processStatusOf(name) ? !name.endsWith("+") && name !== "Ready for Process 2" : byName.has(name));

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
