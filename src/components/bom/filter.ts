import { getMachine } from "@/config/machines";
import { matchesDate, type Filters } from "@/components/shell/FilterContext";
import { partTitle, type CardPart } from "./types";

// The top bar's search, Material, Process and Date filters, shared by the BOM and To Fab.
export function matchesTopBar(p: CardPart, { q, material, process, date }: Filters): boolean {
  if (process && ![p.preProcess, p.process1, p.process2].includes(process)) return false;
  if (material && p.material !== material) return false;
  if (!matchesDate(p.lastModifiedAt, date)) return false;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [partTitle(p), p.onshapeName, p.material, ...[p.preProcess, p.process1, p.process2].map((m) => (m ? getMachine(m)?.name : null))]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}
