import type { FabArea } from "@/config/machines";
import { FACTORY_STATUSES, PRINT_STATUSES, isFactoryStatus, isPrintStatus, processStatusOf } from "@/config/statuses";

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
// instruct: write the Assembly page's steps (CAD too, Harel 2026-11-10; ticking them is work).
// check: run the CAD page's Design check, set a part's weight, mark an overlap as fine (CAD too,
// Harel 2026-11-13; its limits are manage).
// discard: delete inventory items (to Recently deleted); every team, like work, so the Inventory
// page's long-press menu offers Delete and Move to CAD and Build too (Harel, 2026-11-19).
// manage: everything else (other deletes, robot and system settings, Settings).
export type Capability = "work" | "draw" | "review" | "sync" | "classify" | "shape" | "instruct" | "check" | "discard" | "manage";

export function can(mode: Mode, cap: Capability): boolean {
  if (cap === "work" || cap === "discard") return mode !== "none";
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
  "process1",
  "process2",
  "addedProcesses",
  "appendProcess",
  "addAt",
  "addedDone",
  "qaHeld",
  "material",
  "inventoryItemId",
  "quantity",
  "note",
  "doneProcess1",
  "postDone",
  "add",
  "fabricators",
  "estMinutes",
  "actualMinutes",
  "stockCount",
  "fromStock",
  "cotsSentBack",
  "cotsDeliveryDate",
  "orderName",
  "orderQty",
  "cotsLinks",
  "unitPrice",
  "cotsCategory",
]);

export function partChangesCapability(changes: object): Capability {
  const keys = Object.keys(changes);
  // Approving a part's QA (or taking it back) is CAD's review (Harel, 2026-11-20).
  if (keys.length === 1 && keys[0] === "qa") return "review";
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
  process1: null,
  addedProcesses: [] as { machine: string; qa: boolean }[],
  inventoryItemId: null,
  cotsCategory: null,
  doneProcess1: 0,
} as const;

// True when `changes` is exactly RESET_SPECS (every field, same values, nothing else).
export function isSpecReset(changes: object): boolean {
  const keys = Object.keys(changes);
  const reset = RESET_SPECS as Record<string, unknown>;
  return keys.length === Object.keys(reset).length && keys.every((k) => k in reset && JSON.stringify((changes as Record<string, unknown>)[k]) === JSON.stringify(reset[k]));
}

// ---------- Status rules by team (Harel, 2026-10-30) ----------
// Admins in Edit set any status. The CAD Team releases parts with the Release button (its
// checklist) and otherwise only sends them to Reproduction or Secondary Production, with a note
// saying why. The Build Team works parts through the shop: Released, In Process, Post Processing,
// Ready for QA. On a COTS part the CAD Team's two statuses put it back in the Order List.
export const RELEASE_STATUS = "Released";
export const NOTE_STATUSES: readonly string[] = ["Reproduction", "Secondary Production"];
// "In Process" is the part's current process: In Process 1, or Released P2+ / In Process 2+ after
// it (the menu offers each added process's own number).
export const BUILD_STATUSES: readonly string[] = ["Released", "In Process 1", "Released P2+", "In Process 2+", "Post Processing", "Ready for QA"];
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
export function statusDenied(mode: Mode, picked: string | undefined, opts: { cots: boolean; factory?: boolean; print?: boolean; note?: string | null; reset?: boolean }): string | null {
  // "Released P3" / "In Process 3" follow the rules of their group (Released P2+ / In Process 2+).
  const status = picked && (processStatusOf(picked)?.group ?? picked);
  if (status && opts.print && !opts.cots) {
    if (!isPrintStatus(status)) return "3D printed parts take Not Started, Released, Sliced, Printing, Ready for QA, In Stock or Reproduction.";
    if (mode === "edit") return null;
    if (mode !== "build" && mode !== "cad") return "Ask an admin to put you on a team (Build or CAD) to make changes.";
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
  return "Ask an admin to put you on a team (Build or CAD) to make changes.";
}
