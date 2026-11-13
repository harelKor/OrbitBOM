import { RELEASE_STATUS } from "@/components/shell/mode";

// A made part is released only once it has a machine and a material: without them Shop Fab and
// Factory Fab can't place it (Harel, 2026-11-13; before, it was released with a warning).
export const FAB_SETUP_REQUIRED = "A part needs a machine and a material before it can be released.";

type Part = { classification: string; material: string | null; preProcess: string | null; process1: string | null; process2: string | null };

// An in-house part To Fab can't place: no machine (no process) or no material.
export const missingFabSetup = (p: Part) => p.classification !== "cots" && (!p.material || (!p.preProcess && !p.process1 && !p.process2));

// Why `changes` would release a part that has no machine or material, or null. Fields changed in
// the same edit count.
export function fabSetupDenied(part: Part, changes: Partial<Part> & { status?: string }): string | null {
  if (changes.status !== RELEASE_STATUS) return null;
  const next = { ...part, ...Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined)) } as Part;
  return missingFabSetup(next) ? FAB_SETUP_REQUIRED : null;
}
