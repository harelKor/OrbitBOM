// computeStatus: the one status function shared by the UI, stats views and MCP (plan §3).
// Mirrors FRCBOM's status.js (ref §4):
// - a new part is Not Started;
// - while every done counter is 0, the status is the stored design_state;
// - once any counter is above 0, the status is derived from the first unfinished process;
// - COTS parts use their own statuses (config/cots.ts) and ignore the counters;
// - a part at a Factory Fab factory reads as one of FACTORY_STATUSES, at a team printer as
//   PRINT_STATUSES: the machine of the process it is at now decides (Harel, 2026-11-20).
//
// Processes (Harel, 2026-11-20): Process 1, then any number of added processes, each with its own
// machine, done counter and "QA needed" tick (QA before that process starts). Finishing process N
// releases the part to N+1 (Released P{N+1}), or sends it to Ready for QA first when N+1 needs QA;
// a CAD member's approval then releases it. After the last process: Ready for QA → In Stock.
// Process 1 may be COTS: bought on the Order List, then always QA before the next process.

import {
  DEFAULT_STATUS,
  DONE_STATUSES,
  IN_PROCESS_LATER,
  LEGACY_STATUSES,
  READY_FOR_QA,
  RELEASED_LATER,
  getStatus,
  isPickableStatus,
  isStatusName,
  processStatusName,
  processStatusOf,
  statusLabel,
  toFactoryStatus,
  toPrintStatus,
  type StatusName,
} from "@/config/statuses";
import { COTS_PROCESS, areaOfMachine, isFactoryFabMachine, isPrinter, type FabArea } from "@/config/machines";
import { COTS_IN_STOCK, ORDER_STATUSES, cotsStatusOf, isCotsStatusName, type CotsStatusName } from "@/config/cots";

// A made part's status or a COTS part's.
export type PartStatus = StatusName | CotsStatusName;

// A process added after Process 1 (parts.added_processes). `qa`: QA is needed before it starts;
// `qaDone`: that QA was approved.
export type AddedProcess = { machine: string; done: number; qa: boolean; qaDone?: boolean };

export type StatusInput = {
  classification: "inhouse" | "cots" | "external" | "undefined";
  quantity: number;
  designState: string | null;
  process1: string | null;
  doneProcess1: number;
  addedProcesses: AddedProcess[];
  // The last "+" finished a step that leads to QA and the member answered "No" to "Move to QA?":
  // the part stays at its process until the card's Move to QA (Harel, 2026-11-20).
  qaHeld: boolean;
  // A bought part arrived from the Order List and waits for CAD's QA (Harel, 2026-11-20).
  cotsQa: boolean;
};

// One process of a part, Process 1 first.
export type Proc = { machine: string | null; done: number; qa: boolean; qaDone: boolean };

export const isCotsProcess = (part: Pick<StatusInput, "process1">) => part.process1 === COTS_PROCESS;

export function processesOf(part: Pick<StatusInput, "process1" | "doneProcess1" | "addedProcesses">): Proc[] {
  return [
    { machine: part.process1, done: part.doneProcess1, qa: false, qaDone: true },
    // A bought Process 1 is always checked before the next process.
    ...(part.addedProcesses ?? []).map((p, i) => ({ machine: p.machine, done: p.done, qa: p.qa || (i === 0 && isCotsProcess(part)), qaDone: !!p.qaDone })),
  ];
}

function storedStatus(designState: string | null): StatusName {
  if (designState && isStatusName(designState)) return designState;
  const later = processStatusOf(designState);
  if (later) return later.group;
  if (designState && designState in LEGACY_STATUSES) return LEGACY_STATUSES[designState];
  return DEFAULT_STATUS;
}

export function hasProgress(part: Pick<StatusInput, "process1" | "doneProcess1" | "addedProcesses">): boolean {
  return processesOf(part).some((p) => p.done > 0);
}

// Where a made part is: its status (before the factory / printer lists), the process it is at
// (0 = Process 1; past the last one once all are done) and whether a Ready for QA is mid-way
// (before an added process) rather than the final one.
export type Stage = { status: StatusName | CotsStatusName; index: number; midQa: boolean; buying: boolean };

const ORDERING: string[] = ORDER_STATUSES.filter((s) => s !== COTS_IN_STOCK);

export function stageOf(part: StatusInput): Stage {
  const procs = processesOf(part);
  const needed = Math.max(part.quantity, 1);
  const last = procs.length - 1;
  if (!hasProgress(part)) {
    // A bought Process 1 still on the COTS page shows its order status.
    if (isCotsProcess(part) && part.designState && ORDERING.includes(part.designState)) return { status: part.designState as CotsStatusName, index: 0, midQa: false, buying: true };
    const later = processStatusOf(part.designState);
    return { status: storedStatus(part.designState), index: later ? Math.min(later.n - 1, last) : 0, midQa: false, buying: false };
  }
  const c = procs.findIndex((p) => p.machine && p.done < needed);
  const inProcess = (i: number): Stage => ({ status: i === 0 ? "In Process 1" : IN_PROCESS_LATER, index: i, midQa: false, buying: false });
  if (c === -1) return part.qaHeld ? inProcess(last) : { status: READY_FOR_QA, index: last, midQa: false, buying: false };
  const p = procs[c];
  if (p.done > 0 || c === 0) return inProcess(c);
  // A status picked at this process ("In Process 3", a factory's In Factory) reads here.
  const picked = part.designState ? storedStatus(part.designState) : null;
  if (picked && picked !== RELEASED_LATER && (PICKED_AT_PROCESS as string[]).includes(picked)) return { status: picked, index: c, midQa: false, buying: false };
  if (p.qa && !p.qaDone) return part.qaHeld ? inProcess(c - 1) : { status: READY_FOR_QA, index: c, midQa: true, buying: false };
  return { status: RELEASED_LATER, index: c, midQa: false, buying: false };
}

// Statuses picked for the process a part is at, kept with the earlier processes' counts.
const PICKED_AT_PROCESS: StatusName[] = ["Released", "Gcoded", "In Process 1", IN_PROCESS_LATER, "In Factory", "Post Processing", "Reproduction", "Secondary Production"];

// Every process's machine, in order (a bought Process 1 is "cots").
export const processMachines = (part: Pick<StatusInput, "process1" | "addedProcesses">) =>
  [part.process1, ...(part.addedProcesses ?? []).map((p) => p.machine)].filter((m): m is string => !!m);

// The status a pick of a grouped status gives this part: Released P2+ / In Process 2+ at the
// process it is at (from Process 2 on), or null when the part has no added process.
export function numberedFor(part: StatusInput, status: string): string | null {
  if (status !== RELEASED_LATER && status !== IN_PROCESS_LATER) return status;
  if (!part.addedProcesses?.length) return null;
  const n = Math.min(Math.max(stageOf(part).index + 1, 2), part.addedProcesses.length + 1);
  return processStatusName(status, n);
}

// The status To Fab's batch menu, section drops and Fab give a part at the process it is at
// (audit 2026-11-25, FAB-1/FAB-2): Released and In Process 1 (or the grouped names) become Released
// P{n} / In Process {n} past Process 1, so the earlier processes keep their counts and QA. A part
// waiting for QA before its next process is still at the one before (no QA is skipped). Factory
// and printer parts keep their place through applyStatus; other statuses go as they are.
export function statusAtProcess(part: StatusInput, status: string): string {
  const plain = status === RELEASED_LATER ? "Released" : status === IN_PROCESS_LATER ? "In Process 1" : status;
  if ((plain !== "Released" && plain !== "In Process 1") || part.classification === "cots" || areaOf(part) || !part.addedProcesses?.length) return plain;
  const stage = stageOf(part);
  const index = Math.min(stage.midQa ? stage.index - 1 : stage.index, part.addedProcesses.length);
  return index < 1 ? plain : processStatusName(plain === "Released" ? RELEASED_LATER : IN_PROCESS_LATER, index + 1);
}

// The process (1 = Process 1) that waits for CAD's QA before it may start, or null: nothing is
// counted there until the QA is approved (audit 2026-11-25, BOM-1). Both a part in a mid-way
// Ready for QA and one held at its process after "No" to "Move to QA?" have one.
export function qaGate(part: StatusInput): number | null {
  if (part.classification === "cots" || !hasProgress(part)) return null;
  const procs = processesOf(part);
  const needed = Math.max(part.quantity, 1);
  const c = procs.findIndex((p) => p.machine && p.done < needed);
  if (c < 1) return null;
  const p = procs[c];
  return p.qa && !p.qaDone && p.done === 0 ? c + 1 : null;
}

// Not released yet: Release (and its Select all) leaves every other part as it is (audit
// 2026-11-25, BOM-4).
export const UNRELEASED: string[] = ["Not Started", "Secondary Production"];
export const isUnreleased = (part: StatusInput) => UNRELEASED.includes(computeStatus(part));

// The machine of the process a made part is at now (its last once all are done), else its first.
export function statusMachine(part: StatusInput): string | null {
  if (part.classification === "cots") return null;
  const procs = processesOf(part);
  const { index } = stageOf(part);
  return procs[Math.min(index, procs.length - 1)]?.machine ?? part.process1;
}

// The Factory Fab factory or team printer the part is at now, or null.
export const factoryOf = (part: StatusInput) => {
  const m = statusMachine(part);
  return isFactoryFabMachine(m) ? m : null;
};
export const printerOf = (part: StatusInput) => {
  const m = statusMachine(part);
  return isPrinter(m) ? m : null;
};
export const areaOf = (part: StatusInput): FabArea | null => areaOfMachine(statusMachine(part));

// A COTS part's status on the COTS page and Order List: an arrived part waiting for QA is still
// In Stock there; a bought Process 1 is In Stock once bought (Harel, 2026-11-20).
export function orderStatus(part: StatusInput): CotsStatusName {
  if (part.classification === "cots") return cotsStatusOf(part.designState);
  if (!isCotsProcess(part)) return cotsStatusOf(part.designState);
  const stage = stageOf(part);
  return stage.buying ? (stage.status as CotsStatusName) : hasProgress(part) || stage.index > 0 || isDoneStatus(stage.status) ? COTS_IN_STOCK : cotsStatusOf(part.designState);
}

// A part bought as its Process 1 that hasn't arrived yet: it takes the COTS statuses (Released,
// the Order List...) in the BOM too.
export function buyingNow(part: StatusInput): boolean {
  if (part.classification === "cots" || part.classification === "external" || !isCotsProcess(part) || hasProgress(part)) return false;
  const stage = stageOf(part);
  return stage.index === 0 && !isDoneStatus(stage.status);
}

// On the COTS page and Order List: COTS parts and parts bought as their Process 1.
export const isBought = (part: Pick<StatusInput, "classification" | "process1">) => part.classification === "cots" || (part.classification !== "external" && isCotsProcess(part));

const isDoneStatus = (s: string) => (DONE_STATUSES as string[]).includes(s);

export function computeStatus(part: StatusInput): PartStatus {
  if (part.classification === "cots") {
    const s = cotsStatusOf(part.designState);
    return s === COTS_IN_STOCK && part.cotsQa ? READY_FOR_QA : s;
  }
  const stage = stageOf(part);
  if (stage.buying) return stage.status;
  const status = stage.status as StatusName;
  // A Factory Fab factory's part shows one of the factory statuses, whatever it was set to before.
  // A team 3D printer's part shows one of the print statuses.
  const area = areaOf(part);
  return area === "factory" ? toFactoryStatus(status) : area === "print" ? toPrintStatus(status) : status;
}

// The part's status as its machine calls it ("Printing" on a 3D printer), with its process
// number ("Released P3", "In Process 3").
export function partStatusLabel(part: StatusInput): string {
  const status = computeStatus(part);
  if (part.classification === "cots") return status;
  const stage = stageOf(part);
  const n = stage.index + 1;
  if (status === RELEASED_LATER || status === IN_PROCESS_LATER) return processStatusName(status, n);
  // A factory's or printer's part at its second or later process.
  if (status === "Released" && n > 1 && hasProgress(part)) return `Released P${n}`;
  return statusLabel(status, statusMachine(part));
}

// Released P2+ to a process that needed QA first: it came back from QA approved, so it starts
// over as a loose Released part on Shop Fab, out of its old batch (Harel, 2026-11-20).
export function releasedAfterQa(part: StatusInput): boolean {
  if (part.classification === "cots") return false;
  const stage = stageOf(part);
  if (stage.status !== RELEASED_LATER || stage.index < 1) return false;
  const p = processesOf(part)[stage.index];
  return !!p?.qa && p.qaDone;
}

// A mid-way Ready for QA (before an added process) isn't done; only the final one is.
export function isMidQa(part: StatusInput): boolean {
  return part.classification !== "cots" && stageOf(part).midQa && computeStatus(part) === READY_FOR_QA;
}

// Where CAD's QA approval sends the part: its next process, else In Stock.
export function qaNext(part: StatusInput): string {
  return isMidQa(part) ? `Released P${stageOf(part).index + 1}` : COTS_IN_STOCK;
}

// A Ready for QA for a part that was just bought (COTS, or bought as its Process 1): the Ready for
// QA box lists these under COTS, the rest under Shop (Harel, 2026-11-20).
export function isBoughtQa(part: StatusInput): boolean {
  if (computeStatus(part) !== READY_FOR_QA) return false;
  if (part.classification === "cots") return true;
  if (!isCotsProcess(part)) return false;
  const stage = stageOf(part);
  return (stage.midQa && stage.index === 1) || !part.addedProcesses?.length;
}

export function isDone(part: StatusInput): boolean {
  return isDoneStatus(computeStatus(part)) && !isMidQa(part);
}

// The write side of the hybrid model: choosing a status from the menu stores it as the design
// state and resets the counters, so the stored status shows again. A numbered status (Released
// P3, In Process 3) counts the processes before it as done; a status the part's factory or printer
// picks at a later process keeps the earlier processes (Harel, 2026-11-20).
export function applyStatus(status: string, part?: StatusInput) {
  if (!isPickableStatus(status) && !isCotsStatusName(status)) throw new Error(`Unknown status: ${status}`);
  const added = part?.addedProcesses ?? [];
  const needed = Math.max(part?.quantity ?? 1, 1);
  const later = processStatusOf(status);
  const at = later ? later.n - 1 : part && part.classification !== "cots" && areaOf(part) && (PICKED_AT_PROCESS as string[]).includes(status) ? stageOf(part).index : 0;
  if (at > 0 && at <= added.length) {
    return {
      designState: status,
      doneProcess1: needed,
      addedProcesses: added.map((p, i) => ({ ...p, done: i < at - 1 ? needed : 0, qaDone: i < at })),
      qaHeld: false,
    };
  }
  // The factory or printer finished its process and the part has more: it moves on from there.
  if (part && part.classification !== "cots" && areaOf(part) && (status === READY_FOR_QA || status === COTS_IN_STOCK)) {
    const index = stageOf(part).index;
    if (index < added.length) {
      return {
        designState: null,
        doneProcess1: needed,
        addedProcesses: added.map((p, i) => ({ ...p, done: i < index ? needed : 0, qaDone: i < index || (i === index && !!p.qaDone) })),
        qaHeld: false,
      };
    }
  }
  return {
    designState: status,
    doneProcess1: 0,
    ...(added.length && { addedProcesses: added.map((p) => ({ ...p, done: 0, qaDone: false })) }),
    qaHeld: false,
  };
}

export { getStatus };
