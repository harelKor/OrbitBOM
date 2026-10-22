// computeStatus: the one status function shared by the UI, stats views and MCP (plan §3).
// Mirrors FRCBOM's status.js (ref §4):
// - a new part is Not Started;
// - while every done_* counter is 0, the status is the stored design_state;
// - once any counter is above 0, the status is derived from the first unfinished process slot;
// - COTS parts only use design-stage statuses (counters are ignored).

import {
  DEFAULT_STATUS,
  DERIVED_STATUS,
  DONE_STATUSES,
  getStatus,
  isStatusName,
  statusLabel,
  type StatusName,
} from "@/config/statuses";

export type StatusInput = {
  classification: "inhouse" | "cots" | "external";
  quantity: number;
  designState: string | null;
  preProcess: string | null;
  process1: string | null;
  process2: string | null;
  donePreprocess: number;
  doneProcess1: number;
  doneProcess2: number;
};

const SLOTS = [
  { machine: "preProcess", done: "donePreprocess", status: DERIVED_STATUS.preprocess },
  { machine: "process1", done: "doneProcess1", status: DERIVED_STATUS.process1 },
  { machine: "process2", done: "doneProcess2", status: DERIVED_STATUS.process2 },
] as const;

function storedStatus(designState: string | null): StatusName {
  if (designState && isStatusName(designState)) return designState;
  return DEFAULT_STATUS;
}

export function hasProgress(part: StatusInput): boolean {
  return part.donePreprocess > 0 || part.doneProcess1 > 0 || part.doneProcess2 > 0;
}

export function computeStatus(part: StatusInput): StatusName {
  if (part.classification === "cots" || !hasProgress(part)) {
    return storedStatus(part.designState);
  }
  const needed = Math.max(part.quantity, 1);
  for (const slot of SLOTS) {
    if (!part[slot.machine]) continue;
    if (part[slot.done] < needed) return slot.status;
  }
  return DERIVED_STATUS.done;
}

// The machine a part's status is at: the first process it hasn't finished, else its first one.
export function statusMachine(part: StatusInput): string | null {
  const needed = Math.max(part.quantity, 1);
  const slot = SLOTS.find((s) => part[s.machine] && part[s.done] < needed);
  return (slot && part[slot.machine]) ?? part.process1 ?? part.preProcess ?? part.process2;
}

// The part's status as its machine calls it ("Printing" on a 3D printer).
export function partStatusLabel(part: StatusInput): string {
  return statusLabel(computeStatus(part), part.classification === "cots" ? null : statusMachine(part));
}

export function isDone(part: StatusInput): boolean {
  return DONE_STATUSES.includes(computeStatus(part));
}

// The write side of the hybrid model: choosing a status from the menu stores it as the design
// state and resets the counters, so the stored status shows again.
export function applyStatus(status: string) {
  if (!getStatus(status)) throw new Error(`Unknown status: ${status}`);
  return { designState: status, donePreprocess: 0, doneProcess1: 0, doneProcess2: 0 };
}

// Moving a counter clears the stored design state, as FRCBOM does.
export function applyCounters(counters: {
  donePreprocess?: number;
  doneProcess1?: number;
  doneProcess2?: number;
}) {
  const anyMoved = Object.values(counters).some((n) => (n ?? 0) > 0);
  return anyMoved ? { ...counters, designState: null } : counters;
}
