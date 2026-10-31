import { getMachine } from "@/config/machines";
import type { Filters } from "@/components/shell/FilterContext";
import { partTitle, type CardPart } from "./types";

// The top bar's part search, shared by the BOM, To Fab and To Review.
export function matchesTopBar(p: CardPart, { q }: Pick<Filters, "q">): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [partTitle(p), p.onshapeName, p.material, ...[p.preProcess, p.process1, p.process2].map((m) => (m ? getMachine(m)?.name : null))]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

// The BOM filter row's Material and Process pills.
export function matchesPills(p: CardPart, { material, process }: Pick<Filters, "material" | "process">): boolean {
  if (process && ![p.preProcess, p.process1, p.process2].includes(process)) return false;
  if (material && p.material !== material) return false;
  return true;
}
