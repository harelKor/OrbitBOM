// The tag on a part card: COTS (bought), In factory (made by a partner factory: a Zivudim,
// HadasaS or Beth El process), In-house (made by the team) or Undefined (a new part nobody has
// typed yet). In factory follows the processes,
// so it is never stored.

import { isFactoryMachine } from "@/config/machines";

export type PartTag = "cots" | "factory" | "inhouse" | "undefined";

export const PART_TAG_LABELS: Record<PartTag, string> = { cots: "COTS", factory: "IN FACTORY", inhouse: "IN-HOUSE", undefined: "UNDEFINED" };

export function partTag(part: {
  classification: string;
  process1: string | null;
  addedProcesses?: { machine: string }[];
}): PartTag {
  if (part.classification === "cots") return "cots";
  if ([part.process1, ...(part.addedProcesses ?? []).map((p) => p.machine)].some(isFactoryMachine)) return "factory";
  return part.classification === "undefined" ? "undefined" : "inhouse";
}
