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
// from Onshape and system versions. classify: a part's type, COTS or In-House (Harel, 2026-10-31).
// manage: everything else (deletes, bulk edit, merge, manual parts, robot and system settings,
// Settings).
export type Capability = "work" | "draw" | "review" | "sync" | "classify" | "manage";

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
  "cotsLinks",
  "unitPrice",
  "cotsCategory",
]);

export function partChangesCapability(changes: object): Capability {
  const keys = Object.keys(changes);
  if (keys.every((k) => WORK_PART_FIELDS.has(k))) return "work";
  if (keys.every((k) => k === "drawingUrl" || WORK_PART_FIELDS.has(k))) return "draw";
  const c = (changes as { classification?: unknown }).classification;
  if ((c === "inhouse" || c === "cots") && keys.every((k) => k === "classification" || WORK_PART_FIELDS.has(k))) return "classify";
  return "manage";
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

// The made-part statuses a mode picks from a card, table, filter or To Fab menu; null = all.
export function pickableStatuses(mode: Mode): readonly string[] | null {
  if (mode === "cad") return NOTE_STATUSES;
  if (mode === "build") return BUILD_STATUSES;
  return null;
}

// Why the mode can't give these parts this status, or null when it can. `note` is the note sent
// with the change: Reproduction and Secondary Production need one.
export function statusDenied(mode: Mode, status: string | undefined, opts: { cots: boolean; note?: string | null }): string | null {
  if (!status || mode === "edit") return null;
  const noted = !!opts.note?.trim();
  if (mode === "cad") {
    if (status === RELEASE_STATUS || (!opts.cots && QA_STATUSES.includes(status))) return null;
    const needsNote = opts.cots ? status === COTS_REORDER : NOTE_STATUSES.includes(status);
    if (needsNote) return noted ? null : "Write why the part needs Reproduction or Secondary Production.";
    return "The CAD Team releases parts with Release, or sends them to Reproduction or Secondary Production.";
  }
  if (mode === "build") {
    if (opts.cots || BUILD_STATUSES.includes(status)) return null;
    return "The Build Team can set Released, In Process, Post Processing or Ready for QA.";
  }
  return "Pick a team on your profile (Build or CAD) to make changes.";
}
