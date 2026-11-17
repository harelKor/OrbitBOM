// What a button spends from a capped budget, shown in a small popup when a member hovers it, holds
// it on a phone or tabs to it (Harel, 2026-11-17: "whenever you hover over a button which wastes
// calls, show a small pop up with the estimated amount of calls it takes"). Read from the code
// paths, never measured by calling Onshape; each flow logs its real count (`onshape calls
// flow=… total=…` in the server log), so adjust these against that. Budgets: the team's Onshape
// calls (src/config/onshapeBudget.ts), Serper credits and Gemini requests (src/config/apiLimits.ts).

export type Budget = "onshape" | "serper" | "gemini";

// `low`–`high` calls (high omitted = exactly low). `how` says what makes it grow, in a few words.
export type CallCost = { budget: Budget; low: number; high?: number; how?: string };

const UNITS: Record<Budget, [string, string]> = {
  onshape: ["Onshape call", "Onshape calls"],
  serper: ["Serper credit", "Serper credits"],
  gemini: ["Gemini request", "Gemini requests"],
};

const cost = (budget: Budget, low: number, high?: number, how?: string): CallCost => ({ budget, low, high: high !== undefined && high > low ? high : undefined, how });

// Fixed costs. A Part Studio "changed" = its revision moved since the last read: answers about a
// Part Studio are kept under its revision, so an unchanged one costs nothing (plan/onshape-calls.md).
export const CALL_COSTS = {
  // Update BOM's check (BOM page's Update System, panel's Update BOM): the workspace microversion,
  // the BOM, 1–2 element lists, then mass properties per changed Part Studio.
  checkBom: cost("onshape", 3, 12, "+1 per changed Part Studio"),
  // A single Outdated part's commit: no Onshape version, just its Part Studio's parts list.
  commitOnePart: cost("onshape", 0, 1),
  // Update CAD / Update Basepart's check: the assembly definition, element lists, fingerprints and
  // the new Part Studio files the previews show.
  checkCad: cost("onshape", 2, 12, "+1–2 per changed Part Studio"),
  // Update 3D model on a robot page: 1 microversion per linked workspace document; when something
  // moved, its assembly definitions, element lists and a tessellation per changed Part Studio
  // (+1 parts list when bodies come without a colour).
  update3d: cost("onshape", 1, 20, "+1 per changed Part Studio"),
  // First link of an assembly in the panel: a whole first sync (BOM, version names, then every
  // Part Studio's parts list and file). About 25 for a 15-Part-Studio system.
  linkAssembly: cost("onshape", 5, 40, "5 + 1–2 per Part Studio"),
  // Sync / Replace as Basepart, and saving its Geometry sketches: the Basepart 3D rebuilt after
  // (microversion, definition, its Part Studio files, the sketches).
  basepart: cost("onshape", 2, 8),
  // CAD tree's Refresh from Onshape: the document's version list, whatever its length.
  refreshVersions: cost("onshape", 1),
  // Building an old version nobody kept: its plan (2–3), then the Part Studio files R2 doesn't have.
  buildVersion: cost("onshape", 2, 15, "+1 per Part Studio file not kept yet"),
  // Fetch Onshape drawings: the document's tab list (kept a while), then each matched drawing tab
  // as a PDF (a translation: start, a poll or two, download).
  fetchDrawings: cost("onshape", 1, 3, "+2–3 per matched drawing tab"),
  // Part CAD downloads: STL is one call; STEP, Parasolid and flat STEP are a translation (start,
  // polls, download). Free once exported: the file is kept in R2 per part revision.
  exportStl: cost("onshape", 0, 1, "free when already exported"),
  exportTranslated: cost("onshape", 0, 4, "free when already exported"),
  // A plate's DXF is drawn from its mesh: Onshape only if the mesh isn't kept yet.
  exportPlateDxf: cost("onshape", 0, 2),
  // To Fab's Onshape Layout: create or empty the batch's tab and insert every copy (2–3), plus
  // about 5–8 per sheet metal part the first time its flat pattern is imported.
  onshapeLayout: cost("onshape", 2, 4, "+5–8 per new sheet metal part"),
  // The batch's Onshape assembly as one STEP file: a translation.
  layoutStep: cost("onshape", 3, 5),
  // Inventory: "Search the web" is Serper Shopping + Search (2 credits); a Lens photo search 3.
  webSearch: cost("serper", 2),
  lens: cost("serper", 3),
  // Gemini: one request each (the scan's specs card, the design check's write-up, Suggest loads).
  gemini: cost("gemini", 1),
} satisfies Record<string, CallCost>;

// Drawings made from Onshape geometry: body details + edges, 2 per Part Studio of the picked parts
// that aren't drawn at their revision yet, so at most 2 per picked part.
export const makeDrawingsCost = (parts: number): CallCost => cost("onshape", 2, Math.max(2, 2 * parts), parts > 1 ? `up to 2 per picked part (${parts})` : undefined);

// Commit after Update BOM's check, fed by the Commit window's change count (a Part Studio holds
// one changed part or several, so it's the most it can be): the "V<n> BOM release" version (+2
// when the BOM is in a Manufacture document), a parts list per changed Part Studio for the export
// files, and with "Update the 3D views" the rebuild on top (definition, 1–2 element lists, a
// tessellation per changed Part Studio).
export function commitBomCost(changedParts: number, update3d: boolean): CallCost {
  const studios = Math.max(1, changedParts);
  return update3d ? cost("onshape", 4, 6 + 2 * studios, "fewer when parts share a Part Studio") : cost("onshape", 1, 3 + studios, "fewer when parts share a Part Studio");
}

// Update CAD / Update Basepart's commit: an Onshape version when ticked, then that model's 3D
// rebuild (definition, element lists; the changed Part Studio files were mostly made by the check).
export const commitCadCost = (changedParts: number, makeVersion: boolean): CallCost => cost("onshape", 2 + (makeVersion ? 1 : 0), 4 + (makeVersion ? 1 : 0) + changedParts);

// "≈ 3–12 Onshape calls · +1 per changed Part Studio". Several budgets join with " + ".
export function costLabel(...costs: CallCost[]): string {
  return costs
    .map((c) => {
      const n = c.high === undefined ? c.low : Math.max(c.high, c.low);
      const range = c.high === undefined ? `${c.low}` : `${c.low}–${c.high}`;
      const unit = UNITS[c.budget][n === 1 ? 0 : 1];
      return `${c.high === undefined ? "" : "≈ "}${range} ${unit}${c.how ? ` · ${c.how}` : ""}`;
    })
    .join(" + ");
}

// Spread on a button or link: `<button {...costHint(CALL_COSTS.checkBom)}>`. The popup itself is
// CallCostHints (src/components/ui/CallCost.tsx), mounted once in the root layout.
export function costHint(...costs: CallCost[]): { "data-cost": string } {
  return { "data-cost": costLabel(...costs) };
}

// A part's CAD download in `format` (an ExportFormat name).
export const exportCost = (format: string): CallCost =>
  format === "STL" ? CALL_COSTS.exportStl : format === "DXF" || format === "DXF_FLAT" ? CALL_COSTS.exportPlateDxf : CALL_COSTS.exportTranslated;

// A batch's files at once: up to a translation per part, nothing for parts already exported.
export const exportManyCost = (parts: number): CallCost => cost("onshape", 0, 4 * parts, `free for parts already exported (${parts} ${parts === 1 ? "part" : "parts"})`);

// The part window's Open flatten on a sheet metal part: the flat body's tessellation (+1 parts
// list when it comes without a colour). Free once fetched: kept in R2 per Part Studio revision,
// shared with its flat DXF and Auto Layout.
export const openFlatCost = (cached: boolean): CallCost => (cached ? cost("onshape", 0, undefined, "already fetched") : cost("onshape", 1, 2, "free once fetched"));
