// Which parts the shop works on (Shop Fab): parts ready to start (or to make again), then parts
// being made.
// "In Process" covers every status between Released and the done statuses (plan conflict 5).

import { areaOf, areaOfMachine, factoryOf, printerOf, type FabArea } from "@/config/machines";
import type { StatusName } from "@/config/statuses";
import { computeStatus, isDone, type StatusInput } from "@/lib/status";

export const IN_PROCESS_STATUSES: StatusName[] = ["Gcoded", "In Process 1", "Ready for Process 2", "Post Processing"];
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
  const status = computeStatus(part) as StatusName;
  if (IN_PROCESS_STATUSES.includes(status)) return "inProcess";
  if (READY_STATUSES.includes(status)) return "ready";
  return null;
}

// The machines a part goes through, in order.
export const machinesOf = (part: Pick<StatusInput, "preProcess" | "process1" | "process2">) =>
  [part.preProcess, part.process1, part.process2].filter((m): m is string => !!m);

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

const DONE_KEYS = [
  { key: "preProcess", done: "donePreprocess" },
  { key: "process1", done: "doneProcess1" },
  { key: "process2", done: "doneProcess2" },
] as const;
type DoneKey = (typeof DONE_KEYS)[number]["done"];

// To Fab's − / + on a made part (pure, for PartCard and FabListRow). + counts one more at the
// machine being worked on (the first whose counter hasn't reached the quantity); − takes back the
// last one counted, and when that would leave nothing counted the part goes back to In process if
// it was finished, else to Released. A part set to a done status from a menu has its counters at 0
// (applyStatus): it counts as fully made, so + does nothing and − leaves one fewer at the last
// machine, instead of + starting it over at In Process 1 (audit 2026-11-14).
export function fabCounts(part: StatusInput) {
  const slots = DONE_KEYS.filter((s) => part[s.key]);
  const finished = isFabFinished(part);
  const full = Math.max(part.quantity, 1);
  const progress = part.donePreprocess + part.doneProcess1 + part.doneProcess2;
  const allMade = finished && progress === 0;
  const done = (s: (typeof DONE_KEYS)[number]) => (allMade ? full : part[s.done]);
  const current = slots.find((s) => done(s) < full);
  const counted = slots.slice(0, current ? slots.indexOf(current) + 1 : slots.length).reverse().find((s) => done(s) > 0);
  const made = current ? done(current) : part.quantity;
  let takeBack: { add: Partial<Record<DoneKey, number>> } | { counters: Partial<Record<DoneKey, number>> } | { status: StatusName };
  const left = slots.reduce((n, s) => n + done(s), 0) - 1;
  if (!counted || left <= 0) takeBack = { status: finished ? IN_PROCESS_STATUS : READY_STATUS };
  else if (allMade) takeBack = { counters: Object.fromEntries(slots.map((s) => [s.done, s === counted ? full - 1 : full])) };
  else takeBack = { add: { [counted.done]: -1 } };
  const addOne = current ? { add: { [current.done]: 1 } } : null;
  return { slots, current, counted, finished, made, takeBack, addOne };
}

// Why these parts can't make one fab batch on this machine (Fab and moving parts into a batch
// share it): every part goes through the machine, and a Shop Fab batch is one material. A Factory
// Fab or 3D Printing pack goes whole, whatever its parts are made of.
export function fabBatchRefusal(
  machine: { id: string; name: string },
  parts: (Pick<StatusInput, "preProcess" | "process1" | "process2"> & { material: string | null })[],
): string | null {
  if (parts.some((p) => !machinesOf(p).includes(machine.id))) return `Every part in the fab must go through ${machine.name}.`;
  if (!areaOfMachine(machine.id) && new Set(parts.map((p) => p.material ?? "")).size > 1) return "A fab can only hold parts of one material.";
  return null;
}
