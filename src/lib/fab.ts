// Which parts the shop works on (To Fab): parts ready to start (or to make again), then parts
// being made.
// "In Process" covers every status between Released and the done statuses (plan conflict 5).

import { factoryOf } from "@/config/machines";
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
  // Parts made at a Factory Fab factory are on Factory Fab, not To Fab (Harel, 2026-11-04).
  if (factoryOf(part)) return null;
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
export const isFabFinished = (part: StatusInput) => part.classification !== "cots" && !factoryOf(part) && machinesOf(part).length > 0 && isDone(part);

// A Factory Fab part on the shelf: parts.fab_finished_at records since when, so the factory page
// shows it under In Stock for a month (Harel, 2026-11-04).
export const isFactoryInStock = (part: StatusInput) => part.classification !== "cots" && !!factoryOf(part) && computeStatus(part) === "In Stock";

// Factory Fab's queue: the factory a part is waiting at (Released, In Factory or Ready for QA), or
// null. The side panel's counts and the factory boxes count these.
const FACTORY_QUEUE: readonly string[] = ["Released", "In Factory", "Ready for QA"];
export function factoryQueue(part: StatusInput): string | null {
  if (part.classification === "cots") return null;
  const factory = factoryOf(part);
  return factory && FACTORY_QUEUE.includes(computeStatus(part)) ? factory : null;
}
// A factory's part (or whole pack) stays under In Stock this long after it got there.
export const FACTORY_IN_STOCK_DAYS = 30;

// A batch made under a machine is named after it and the day it was made: "Laser 21/10".
export function fabBatchName(machineName: string, date = new Date()) {
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }).format(date);
  return `${machineName} ${day}`;
}
