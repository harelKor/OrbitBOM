import { getMachine } from "@/config/machines";
import type { Filters } from "@/components/shell/FilterContext";
import { matchesSearch } from "@/lib/inventory/searchWords";
import { partTitle, type CardPart } from "./types";

// The top bar's part search, shared by the BOM, To Fab and To Review. Matches the way the
// Inventory search does (matchesSearch): every typed word, in any order, Hebrew or English shop
// words alike, so "alu 1/4" or "מיסב" finds the same things on every page.
export function matchesTopBar(p: CardPart, { q }: Pick<Filters, "q">): boolean {
  if (!q.trim()) return true;
  const haystack = [partTitle(p), p.onshapeName, p.partNumber, p.material, ...[p.preProcess, p.process1, p.process2].map((m) => (m ? getMachine(m)?.name : null))]
    .filter(Boolean)
    .join(" ");
  return matchesSearch(haystack, q);
}

// The BOM filter row's Material and Process pills.
export function matchesPills(p: CardPart, { material, process }: Pick<Filters, "material" | "process">): boolean {
  if (process && ![p.preProcess, p.process1, p.process2].includes(process)) return false;
  if (material && p.material !== material) return false;
  return true;
}
