// The tag on a part card: COTS (bought), In factory (made by a partner factory: a Zivudim,
// HadasaS or Beth El process) or In-house (made by the team). In factory follows the processes,
// so it is never stored.

import { isFactoryMachine } from "@/config/machines";

export type PartTag = "cots" | "factory" | "inhouse";

export const PART_TAG_LABELS: Record<PartTag, string> = { cots: "COTS", factory: "IN FACTORY", inhouse: "IN-HOUSE" };

export function partTag(part: {
  classification: string;
  preProcess: string | null;
  process1: string | null;
  process2: string | null;
}): PartTag {
  if (part.classification === "cots") return "cots";
  return [part.preProcess, part.process1, part.process2].some(isFactoryMachine) ? "factory" : "inhouse";
}
