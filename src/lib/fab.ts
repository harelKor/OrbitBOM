// Which parts the shop works on (To Fab): parts being made, then parts ready to start.
// "In Process" covers every status between Ready to Fab and the done statuses (plan conflict 5).

import type { StatusName } from "@/config/statuses";
import { computeStatus, type StatusInput } from "@/lib/status";

export const IN_PROCESS_STATUSES: StatusName[] = ["Build In Queue", "In Process 1", "Ready for Process 2", "Post Processing"];
export const READY_STATUS: StatusName = "Ready to Fab";

export type FabStage = "inProcess" | "ready" | null;

export function fabStage(part: StatusInput): FabStage {
  const status = computeStatus(part);
  if (IN_PROCESS_STATUSES.includes(status)) return "inProcess";
  if (status === READY_STATUS) return "ready";
  return null;
}

// The machines a part goes through, in order.
export const machinesOf = (part: Pick<StatusInput, "preProcess" | "process1" | "process2">) =>
  [part.preProcess, part.process1, part.process2].filter((m): m is string => !!m);
