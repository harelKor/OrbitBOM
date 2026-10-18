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
  { name: "Ready to Fab", color: "#00aaff", kind: "design" },
  { name: "Ordered", color: "#00aaff", kind: "design" },
  { name: "Gcoded", color: "#8c00ff", kind: "design" },
  { name: "Build In Queue", color: "#0040ff", kind: "design" },
  { name: "In Process 1", color: "#0004ff", kind: "design" },
  { name: "Ready for Process 2", color: "#00ffff", kind: "design" },
  { name: "Post Processing", color: "#f302f7", kind: "design" },
  { name: "Ready for QA", color: "#fbff00", kind: "design", done: true },
  { name: "Secondary Production", color: "#ff7b00", kind: "design" },
  { name: "Reproduction", color: "#ff0000", kind: "design" },
  { name: "In Stock", color: "#04ff00", kind: "design", done: true },
  { name: "Spare Production", color: "#00ffb3", kind: "design" },
  { name: "In Spare Stock", color: "#00ff04", kind: "design", done: true },
] as const satisfies readonly StatusDef[];

export type StatusName = (typeof STATUSES)[number]["name"];

export const DEFAULT_STATUS: StatusName = "Not Started";

// Status shown once a fabrication counter has moved. FRCBOM derives a built-in status from the
// first unfinished process slot and, because 1690 hides the built-ins, remaps it to the nearest
// visible status. The remap below is our reading of that behaviour (ref §4).
export const DERIVED_STATUS = {
  preprocess: "Build In Queue",
  process1: "In Process 1",
  process2: "Ready for Process 2",
  done: "Ready for QA",
} as const satisfies Record<string, StatusName>;

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
