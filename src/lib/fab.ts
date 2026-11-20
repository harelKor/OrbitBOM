// Which parts the shop works on (Shop Fab): parts ready to start (or to make again), then parts
// being made.
// "In Process" covers every status between Released and the done statuses (plan conflict 5).

import { COTS_PROCESS, areaOfMachine, getMachine, type FabArea } from "@/config/machines";
import type { StatusName } from "@/config/statuses";
import type { PartChanges } from "@/lib/parts/changes";
import { areaOf, computeStatus, factoryOf, isCotsProcess, isDone, isMidQa, printerOf, processesOf, releasedAfterQa, stageOf, statusMachine, type StatusInput } from "@/lib/status";

// Released P2+ stays with In process, as Ready for Process 2 did: its batch is still being worked.
export const IN_PROCESS_STATUSES: StatusName[] = ["Gcoded", "In Process 1", "Released P2+", "In Process 2+", "Post Processing"];
export const READY_STATUS: StatusName = "Released";
export const READY_STATUSES: StatusName[] = [READY_STATUS, "Reproduction"];
// The status a part dropped into the In process section gets.
export const IN_PROCESS_STATUS: StatusName = "In Process 1";
// The status a part dropped into the Finished section gets.
export const FINISHED_STATUS: StatusName = "Ready for QA";

export type FabStage = "inProcess" | "ready" | null;

export function fabStage(part: StatusInput): FabStage {
  // COTS parts are bought, not made: once released they go to the COTS page, never To Fab.
  if (part.classification === "cots") return null;
  // Parts made at a Factory Fab factory or on a team printer are on Factory Fab or 3D Printing, not
  // Shop Fab (Harel, 2026-11-04).
  if (areaOf(part)) return null;
  // Bought as its Process 1: on the COTS page until it arrives.
  if (isCotsProcess(part) && stageOf(part).index === 0) return null;
  // Waiting for QA before its next process: still in process, not finished (Harel, 2026-11-20).
  if (isMidQa(part)) return "inProcess";
  // Approved at QA for its next process: back under Released, to be batched again (Harel, 2026-11-20).
  if (releasedAfterQa(part)) return "ready";
  const status = computeStatus(part) as StatusName;
  if (IN_PROCESS_STATUSES.includes(status)) return "inProcess";
  if (READY_STATUSES.includes(status)) return "ready";
  return null;
}

// The machines a part goes through, in order (a bought Process 1 isn't one).
export const machinesOf = (part: { process1: string | null; addedProcesses?: readonly { machine: string | null }[] | null }) =>
  [part.process1, ...(part.addedProcesses ?? []).map((p) => p.machine)].filter((m): m is string => !!m && m !== COTS_PROCESS);

// A made part: an in-house part with a machine in a done status (Ready for QA, In Stock, …). To Fab
// shows it in Finished; parts.fab_finished_at records since when.
export const isFabFinished = (part: StatusInput) => part.classification !== "cots" && !areaOf(part) && machinesOf(part).length > 0 && isDone(part);

// A Factory Fab or 3D Printing part on the shelf: parts.fab_finished_at records since when, so its
// page shows it under In Stock for a month (Harel, 2026-11-04).
export const isAreaInStock = (part: StatusInput) => part.classification !== "cots" && !!areaOf(part) && computeStatus(part) === "In Stock";

// The machine an area's part waits at (a factory, or a printer), or null once it's not in that
// area's queue: Released through Ready for QA (a printer's Reproduction too). The side panel's
// counts and the area's boxes count these.
const QUEUE: Record<FabArea, readonly string[]> = {
  factory: ["Released", "In Factory", "Ready for QA"],
  print: ["Released", "Reproduction", "Gcoded", "In Process 1", "Ready for QA"],
};
export function areaQueue(part: StatusInput, area: FabArea): string | null {
  if (part.classification === "cots") return null;
  const machine = area === "factory" ? factoryOf(part) : printerOf(part);
  return machine && QUEUE[area].includes(computeStatus(part)) ? machine : null;
}
export const factoryQueue = (part: StatusInput) => areaQueue(part, "factory");
// The statuses an area's page lists under Released (loose parts waiting to be packed).
export const AREA_READY: Record<FabArea, readonly string[]> = { factory: ["Released"], print: ["Released", "Reproduction"] };
// An area's part (or whole pack) stays under In Stock this long after it got there.
export const FACTORY_IN_STOCK_DAYS = 30;

// A batch made under a machine is named after it and the day it was made: "Laser 21/10".
export function fabBatchName(machineName: string, date = new Date()) {
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }).format(date);
  return `${machineName} ${day}`;
}

// A process slot To Fab counts at: its number (1 = Process 1), machine and done count.
export type FabSlot = { n: number; machine: string; done: number };

// One more (or less) made at process n, from the saved count.
export const countAt = (n: number, d: number): PartChanges => (n === 1 ? { add: { doneProcess1: d } } : { addAt: { process: n, delta: d } });

// To Fab's − / + on a made part (pure, for PartCard and FabListRow). + counts one more at the
// machine being worked on (the first whose counter hasn't reached the quantity); − takes back the
// last one counted, and when that would leave nothing counted the part goes back to In process if
// it was finished, else to Released. A part set to a done status from a menu has its counters at 0
// (applyStatus): it counts as fully made, so + does nothing and − leaves one fewer at the last
// machine, instead of + starting it over at In Process 1 (audit 2026-11-14).
export function fabCounts(part: StatusInput) {
  const slots: FabSlot[] = processesOf(part)
    .map((p, i) => ({ n: i + 1, machine: p.machine, done: p.done }))
    .filter((p): p is FabSlot => !!p.machine && p.machine !== COTS_PROCESS);
  const finished = isFabFinished(part);
  const full = Math.max(part.quantity, 1);
  const progress = processesOf(part).reduce((n, p) => n + p.done, 0);
  const allMade = finished && progress === 0;
  // A status picked at a later process (Released P3): the processes before it are made.
  const at = progress === 0 && !finished ? stageOf(part).index + 1 : 1;
  const done = (s: FabSlot) => (allMade || s.n < at ? full : s.done);
  const current = slots.find((s) => done(s) < full);
  const counted = slots.slice(0, current ? slots.indexOf(current) + 1 : slots.length).reverse().find((s) => done(s) > 0);
  const made = current ? done(current) : part.quantity;
  let takeBack: PartChanges;
  const left = slots.reduce((n, s) => n + done(s), 0) - 1;
  if (!counted || left <= 0) takeBack = { status: finished ? IN_PROCESS_STATUS : READY_STATUS };
  else if (allMade) {
    const value = (s: FabSlot | undefined) => (s === counted ? full - 1 : full);
    const first = slots.find((s) => s.n === 1);
    takeBack = {
      ...(first && { doneProcess1: value(first) }),
      ...(part.addedProcesses.length && { addedDone: part.addedProcesses.map((_, i) => value(slots.find((s) => s.n === i + 2))) }),
    };
  } else takeBack = countAt(counted.n, -1);
  const addOne = current ? countAt(current.n, 1) : null;
  return { slots, current, counted, finished, made, takeBack, addOne };
}

// A Shop Fab batch is one stock: the part's material, which names the Raw Stock item it is cut from
// ("3mm 6061-T6": material and thickness). Factory Fab and 3D Printing packs go whole, whatever
// their parts are made of (audit 2026-11-20, Harel: mixed-material batches aren't allowed).
type BatchPart = StatusInput & { material: string | null };
export const stockOf = (p: { material: string | null }) => p.material?.trim() || null;

// The machine at a part's processes so far (the one it is at now included): a part that moved on
// to its next process (Released P2+ in its CNC batch) still belongs to the batch of the one before.
const machinesSoFar = (p: StatusInput) => {
  const procs = processesOf(p);
  return procs.slice(0, stageOf(p).index + 1).map((x) => x.machine);
};

// Why these parts can't join (or make) one fab batch on this machine; null when they can. Fab,
// dragging onto a batch and Ready to Fab share it. Each joining part must be at that machine now
// (the process it is at, not just any of its processes), and for Shop Fab have a material, one
// stock with the batch's other parts (`already`).
export function fabBatchRefusal(machine: { id: string; name: string }, parts: BatchPart[], already: BatchPart[] = []): string | null {
  const name = (p: BatchPart) => ("displayName" in p && (p.displayName as string | null)) || ("onshapeName" in p && (p.onshapeName as string | null)) || "A part";
  const off = parts.find((p) => statusMachine(p) !== machine.id);
  if (off) {
    const at = statusMachine(off);
    return at ? `${name(off)} is at ${getMachine(at)?.name ?? at} now, not ${machine.name}: a batch only takes parts at its machine.` : `${name(off)} has no machine: give it one before it goes into a batch.`;
  }
  if (areaOfMachine(machine.id)) return null;
  const bare = parts.find((p) => !stockOf(p));
  if (bare) return `${name(bare)} has no material: give it one before it goes into a batch.`;
  const stocks = new Set([...parts, ...already].map(stockOf).filter(Boolean));
  if (stocks.size > 1) return `A batch holds one stock (material and thickness): ${[...stocks].join(", ")}.`;
  return null;
}

// What's wrong with a Shop Fab batch as it is (batches made before these rules, or parts changed
// since they joined): shown on its card rather than changing live data (audit 2026-11-20).
export function fabBatchProblems(machineId: string | null, members: BatchPart[]): string[] {
  if (!machineId || areaOfMachine(machineId) || !members.length) return [];
  const out: string[] = [];
  const bare = members.filter((p) => !stockOf(p)).length;
  if (bare) out.push(bare === members.length ? "No material" : `${bare} part${bare === 1 ? "" : "s"} with no material`);
  const stocks = new Set(members.map(stockOf).filter(Boolean));
  if (stocks.size > 1) out.push(`Mixed stock: ${[...stocks].join(", ")}`);
  const machine = getMachine(machineId)?.name ?? machineId;
  const off = members.filter((p) => !machinesSoFar(p).includes(machineId)).length;
  if (off) out.push(`${off} part${off === 1 ? " isn't" : "s aren't"} at ${machine}`);
  return out;
}
