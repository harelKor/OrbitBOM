// The effective mode is what a member can do. Admins pick Edit (everything), CAD or Build (the
// app exactly as that team sees it); everyone else is locked to their team, or "none" (read only)
// until they pick one on /profile or an admin assigns one on /members. Team members also switch
// View | Edit (`editing`): Edit unlocks editing an inventory item's details.
export type Mode = "edit" | "cad" | "build" | "none";
export type AdminMode = Exclude<Mode, "none">;
export const ADMIN_MODES: readonly AdminMode[] = ["edit", "cad", "build"];
export const MODE_COOKIE = "orbit-mode";
export const ROBOT_COOKIE = "orbit-robot";

// work: status, machines, material, quantities and stock, notes, fab batches, new inventory items.
// draw: make, upload and regenerate drawings. review: To Review and Ready for QA. sync: Update BOM
// from Onshape and system versions. manage: everything else (deletes, bulk edit, merge, manual
// parts, robot and system settings, Settings). edit: a team member's (or admin's) Edit toggle:
// an item's name, category, location, condition, specs, photo and product links.
export type Capability = "work" | "draw" | "review" | "sync" | "edit" | "manage";
export type TeamView = "view" | "edit";

export function can(mode: Mode, cap: Capability, editing = mode === "edit"): boolean {
  if (cap === "work") return mode !== "none";
  if (cap === "edit") return mode !== "none" && editing;
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

// Admins edit in Edit mode only (CAD and Build preview the teams' View). Team members pick View |
// Edit; without a pick Build starts in View and CAD in Edit.
export function effectiveEditing(member: { isAdmin: boolean; team: "cad" | "build" | null }, picked?: string): boolean {
  const mode = effectiveMode(member, picked);
  if (member.isAdmin) return mode === "edit";
  if (mode === "none") return false;
  return picked === "edit" || picked === "view" ? picked === "edit" : mode === "cad";
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
  return "manage";
}
