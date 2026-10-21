// Which parts the shop works on (To Fab): parts ready to start (or to make again), then parts
// being made.
// "In Process" covers every status between Ready to Fab and the done statuses (plan conflict 5).

import type { StatusName } from "@/config/statuses";
import { computeStatus, type StatusInput } from "@/lib/status";

export const IN_PROCESS_STATUSES: StatusName[] = ["Build In Queue", "In Process 1", "Ready for Process 2", "Post Processing"];
export const READY_STATUS: StatusName = "Ready to Fab";
export const READY_STATUSES: StatusName[] = [READY_STATUS, "Reproduction"];
// The status a part dropped into the In process section gets.
export const IN_PROCESS_STATUS: StatusName = "In Process 1";
// The status a part dropped into the Finished section gets.
export const FINISHED_STATUS: StatusName = "Ready for QA";

export type FabStage = "inProcess" | "ready" | null;

export function fabStage(part: StatusInput): FabStage {
  const status = computeStatus(part);
  if (IN_PROCESS_STATUSES.includes(status)) return "inProcess";
  if (READY_STATUSES.includes(status)) return "ready";
  return null;
}

// The machines a part goes through, in order.
export const machinesOf = (part: Pick<StatusInput, "preProcess" | "process1" | "process2">) =>
  [part.preProcess, part.process1, part.process2].filter((m): m is string => !!m);

// A batch made under a machine is named after it and the day it was made: "Laser 21/10".
export function fabBatchName(machineName: string, date = new Date()) {
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" }).format(date);
  return `${machineName} ${day}`;
}
