import type { FabArea } from "@/config/machines";
import { FACTORY_STATUSES, PRINT_STATUSES, isFactoryStatus, isPrintStatus } from "@/config/statuses";

// The effective mode is what a member can do. Admins pick Edit (everything), CAD or Build (the
// app exactly as that team sees it); everyone else is locked to their team, or "none" (read only)
// until they pick one on /profile or an admin assigns one on /members. Team members have no
// toggle: their team's view is the one view they work in.
export type Mode = "edit" | "cad" | "build" | "none";
export type AdminMode = Exclude<Mode, "none">;
export const ADMIN_MODES: readonly AdminMode[] = ["edit", "cad", "build"];
export const MODE_COOKIE = "orbit-mode";
export const ROBOT_COOKIE = "orbit-robot";

// work: status, machines, material, quantities and stock, notes, fab batches, inventory items
// (adding them, and an item's name, category, location, condition, specs, photo and product links).
// draw: make, upload and regenerate drawings. review: To Review and Ready for QA. sync: Update BOM
// from Onshape and system versions. classify: a part's type, COTS, In-House or back to Undefined (Harel, 2026-10-31 and 2026-11-01).
// shape: a system page's Bulk edit, Merge parts and + Manual part (CAD too, Harel 2026-10-31).
// manage: everything else (deletes, robot and system settings, Settings).
export type Capability = "work" | "draw" | "review" | "sync" | "classify" | "shape" | "manage";

export function can(mode: Mode, cap: Capability): boolean {
  if (cap === "work") return mode !== "none";
  if (cap === "manage") return mode === "edit";
  return mode === "edit" || mode === "cad";
}

export function isAdminMode(value: unknown): value is AdminMode {
  return ADMIN_MODES.includes(value as AdminMode);
}

export function effectiveMode(member: { isAdmin: boolean; team: "cad" | "build" | null }, picked?: string): Mode {
  if (member.isAdmin) return isAdminMode(picked) ? picked : "edit";
  return member.team ?? "none";
}

// The part fields a team member changes without manage; a drawing link needs draw, and any other
// field needs Edit mode.
const WORK_PART_FIELDS = new Set([
  "status",
  "preProcess",
  "process1",
  "process2",
  "material",
  "inventoryItemId",
  "quantity",
  "note",
  "donePreprocess",
  "doneProcess1",
  "doneProcess2",
  "postDone",
  "add",
  "fabricators",
  "estMinutes",
  "actualMinutes",
  "stockCount",
  "cotsSentBack",
  "cotsDeliveryDate",
  "cotsLinks",
  "unitPrice",
  "cotsCategory",
]);

export function partChangesCapability(changes: object): Capability {
  const keys = Object.keys(changes);
  if (keys.every((k) => WORK_PART_FIELDS.has(k))) return "work";
  if (keys.every((k) => k === "drawingUrl" || WORK_PART_FIELDS.has(k))) return "draw";
  const c = (changes as { classification?: unknown }).classification;
  if ((c === "inhouse" || c === "cots" || c === "undefined") && keys.every((k) => k === "classification" || WORK_PART_FIELDS.has(k))) return "classify";
  return "manage";
}

// What the part window's ✕ (Name row) sets: the part's type, status, material, machines, inventory
// link and counts back to blank. Admins in Edit and the CAD Team use it (classify, plus the one
// "Not Started" the CAD Team may set, through statusDenied's reset option).
export const RESET_SPECS = {
  classification: "undefined",
  status: "Not Started",
  material: null,
  preProcess: null,
  process1: null,
  process2: null,
  inventoryItemId: null,
  cotsCategory: null,
  donePreprocess: 0,
  doneProcess1: 0,
  doneProcess2: 0,
} as const;

// True when `changes` is exactly RESET_SPECS (every field, same values, nothing else).
export function isSpecReset(changes: object): boolean {
  const keys = Object.keys(changes);
  const reset = RESET_SPECS as Record<string, unknown>;
  return keys.length === Object.keys(reset).length && keys.every((k) => k in reset && (changes as Record<string, unknown>)[k] === reset[k]);
}

// ---------- Status rules by team (Harel, 2026-10-30) ----------
// Admins in Edit set any status. The CAD Team releases parts with the Release button (its
// checklist) and otherwise only sends them to Reproduction or Secondary Production, with a note
// saying why. The Build Team works parts through the shop: Released, In Process, Post Processing,
// Ready for QA. On a COTS part the CAD Team's two statuses put it back in the Order List.
export const RELEASE_STATUS = "Released";
export const NOTE_STATUSES: readonly string[] = ["Reproduction", "Secondary Production"];
// "In Process" is the part's current process: In Process 1, or Ready for Process 2 after it.
export const BUILD_STATUSES: readonly string[] = ["Released", "In Process 1", "Ready for Process 2", "Post Processing", "Ready for QA"];
const COTS_REORDER = "In Order List";
// The Ready for QA check-off (QaSection, review capability) moves parts to In Stock and back.
const QA_STATUSES: readonly string[] = ["Ready for QA", "In Stock"];

// A Factory Fab factory's parts: the Build Team works them through the factory like the Order
// List, from Released to In Stock; the CAD Team only releases them (Harel, 2026-11-04).
export const FACTORY_BUILD_STATUSES: readonly string[] = ["Released", "In Factory", "Ready for QA", "In Stock"];

// A team printer's parts: the CAD Team works them too, not only the Build Team (Harel, 2026-11-04).
// Released from CAD goes through the Release checklist, Reproduction with a note, as elsewhere.
export const PRINT_WORK_STATUSES: readonly string[] = PRINT_STATUSES.filter((s) => s !== "Not Started");

// The made-part statuses a mode picks from a card, table, filter or Shop Fab menu; null = all.
// `area`: the part goes to a Factory Fab factory or a team 3D printer (areaOf in config/machines.ts).
export function pickableStatuses(mode: Mode, area: FabArea | null = null): readonly string[] | null {
  if (area === "print") return mode === "edit" ? PRINT_STATUSES : mode === "build" || mode === "cad" ? PRINT_WORK_STATUSES : [];
  if (area === "factory") return mode === "edit" ? FACTORY_STATUSES : mode === "build" ? FACTORY_BUILD_STATUSES : mode === "cad" ? [RELEASE_STATUS] : [];
  if (mode === "cad") return NOTE_STATUSES;
  if (mode === "build") return BUILD_STATUSES;
  return null;
}

// Why the mode can't give these parts this status, or null when it can. `note` is the note sent
// with the change: Reproduction and Secondary Production need one.
export function statusDenied(mode: Mode, status: string | undefined, opts: { cots: boolean; factory?: boolean; print?: boolean; note?: string | null; reset?: boolean }): string | null {
  if (status && opts.print && !opts.cots) {
    if (!isPrintStatus(status)) return "3D printed parts take Not Started, Released, Sliced, Printing, Ready for QA, In Stock or Reproduction.";
    if (mode === "edit") return null;
    if (mode !== "build" && mode !== "cad") return "Pick a team on your profile (Build or CAD) to make changes.";
    if (!PRINT_WORK_STATUSES.includes(status)) return "Only an admin sets a 3D printed part back to Not Started.";
    if (mode === "cad" && NOTE_STATUSES.includes(status) && !opts.note?.trim()) return "Write why the part needs Reproduction.";
    return null;
  }
  if (status && opts.factory && !opts.cots) {
    if (!isFactoryStatus(status)) return `Factory parts take ${FACTORY_STATUSES.join(", ")}.`;
    if (mode === "build" && !FACTORY_BUILD_STATUSES.includes(status)) return `The Build Team can set ${FACTORY_BUILD_STATUSES.join(", ")} on factory parts.`;
  }
  if (!status || mode === "edit") return null;
  // The part window's ✕ puts a part back to Not Started along with its specs.
  if (mode === "cad" && opts.reset && status === RESET_SPECS.status) return null;
  const noted = !!opts.note?.trim();
  if (mode === "cad") {
    if (status === RELEASE_STATUS || (!opts.cots && QA_STATUSES.includes(status))) return null;
    const needsNote = opts.cots ? status === COTS_REORDER : NOTE_STATUSES.includes(status);
    if (needsNote) return noted ? null : "Write why the part needs Reproduction or Secondary Production.";
    return "The CAD Team releases parts with Release, or sends them to Reproduction or Secondary Production.";
  }
  if (mode === "build") {
    if (opts.cots || opts.factory || BUILD_STATUSES.includes(status)) return null;
    return "The Build Team can set Released, In Process, Post Processing or Ready for QA.";
  }
  return "Pick a team on your profile (Build or CAD) to make changes.";
}
