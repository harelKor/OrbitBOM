// The inventory's starting categories and their fields (Harel, 2026-10-23: categories replace
// part types and material). They seed the inventory_categories table the first time it's read;
// after that the team edits them on the Inventory settings panel, the one exception to "no
// settings UI". `match` guesses an item's category from its name while none is set; it stays here
// because names are matched in code. Screws and other small fasteners aren't tracked
// (Harel, 2026-10-22).

import type { CategoryField } from "@/db/schema";

export type CategorySeed = {
  id: string;
  label: string;
  noun: string;
  sheet?: boolean;
  fields: CategoryField[];
  match: RegExp | null;
};

const BORES = ['1/2" Hex', '3/8" Hex', '1/2" ThunderHex', "SplineXS", "SplineXL", "8mm", '1/2" Round', "5mm"];
const PITCHES = ["GT2 3mm", "HTD 5mm"];

const teeth: CategoryField = { id: "teeth", label: "Teeth", kind: "number", name: "{}T" };
const bore: CategoryField = { id: "bore", label: "Bore", kind: "options", options: BORES };
const length: CategoryField = { id: "length", label: "Length (mm)", kind: "number", name: "{}mm" };

export const DEFAULT_CATEGORIES: CategorySeed[] = [
  { id: "gears", label: "Gears", noun: "Gear", match: /\bgears?\b/i, fields: [teeth, { id: "dp", label: "DP", kind: "options", options: ["20 DP", "32 DP"] }, bore] },
  {
    id: "pulleys",
    label: "Pulleys",
    noun: "Pulley",
    match: /pulley/i,
    fields: [teeth, { id: "pitch", label: "Pitch", kind: "options", options: PITCHES }, { id: "width", label: "Width (mm)", kind: "number", name: "{}mm wide" }, bore],
  },
  { id: "sprockets", label: "Sprockets", noun: "Sprocket", match: /sprocket/i, fields: [teeth, { id: "chain", label: "Chain", kind: "options", options: ["#25", "#35"] }, bore] },
  {
    id: "belts",
    label: "Belts",
    noun: "Belt",
    match: /\bbelts?\b|htd|gt2|timing/i,
    fields: [teeth, { id: "pitch", label: "Pitch", kind: "options", options: PITCHES }, { id: "width", label: "Width (mm)", kind: "number", name: "{}mm wide" }],
  },
  {
    id: "bearings",
    label: "Bearings",
    noun: "Bearing",
    match: /bearing|bushing/i,
    fields: [
      { id: "bore", label: "Bore", kind: "options", options: [...BORES, '3/8" Round', '1/4" Round'] },
      { id: "od", label: "OD", kind: "text", name: "{} OD" },
      { id: "flanged", label: "Flanged", kind: "options", options: ["Flanged", "Radial"] },
    ],
  },
  {
    id: "shafts",
    label: "Shafts",
    noun: "Shaft",
    match: /shaft|hex\s*stock|axle/i,
    fields: [{ id: "profile", label: "Profile", kind: "options", options: ['1/2" Hex', '3/8" Hex', '1/2" ThunderHex', '3/8" ThunderHex', "Round"] }, length],
  },
  {
    id: "motors",
    label: "Motors",
    noun: "",
    match: /motor|\bneo\b|vortex|falcon|kraken|\bcim\b|\b775\b|minion|\bbag\b/i,
    fields: [{ id: "model", label: "Model", kind: "options", options: ["Kraken X60", "Kraken X44", "NEO Vortex", "NEO", "NEO 550", "Falcon 500", "Minion", "CIM", "775pro"] }],
  },
  {
    id: "wheels",
    label: "Wheels",
    noun: "Wheel",
    match: /wheel|omni|mecanum|colson|traction|compliant|stealth|tread/i,
    fields: [
      { id: "diameter", label: "Diameter", kind: "options", options: ['2"', '3"', '4"', '6"'] },
      { id: "type", label: "Type", kind: "options", options: ["Traction", "Omni", "Mecanum", "Compliant", "Colson", "Stealth"] },
      bore,
    ],
  },
  {
    id: "round-tubes",
    label: "Round tubes",
    noun: "Tube",
    match: /round\s*tube|\btube\b.*\bod\b|\bod\b.*\btube\b|\bpipe\b/i,
    fields: [{ id: "material", label: "Material", kind: "material", materials: ["Aluminum Tubes", "Polycarbonate Tubes", "Carbon Fiber Tubes"] }, length],
  },
  {
    id: "square-tubes",
    label: "Square tubes",
    noun: "Box tube",
    match: /(box|square|rect\w*)\s*tube|\btube\b.*\d+\s*x\s*\d+|\d+\s*x\s*\d+.*\btube\b|extrusion/i,
    fields: [{ id: "material", label: "Material", kind: "material", materials: ["Aluminum Extrusions"] }, length],
  },
  {
    id: "aluminum-plates",
    label: "Aluminum plates",
    noun: "Plate",
    sheet: true,
    match: /alumin\w*.*(plate|sheet)|(plate|sheet).*alumin|\b(6061|5052|7075)\b/i,
    fields: [{ id: "material", label: "Material", kind: "material", materials: ["Aluminum Plates"] }, { id: "size", label: "Sheet size (mm)", kind: "text", name: "{}mm" }],
  },
  {
    id: "polycarbonate",
    label: "Polycarbonate plates",
    noun: "Plate",
    sheet: true,
    match: /polycarb|lexan|\bpoly\b|\bpc\b/i,
    fields: [{ id: "material", label: "Material", kind: "material", materials: ["Polycarbonate Plates"] }, { id: "size", label: "Sheet size (mm)", kind: "text", name: "{}mm" }],
  },
  {
    id: "electrical",
    label: "Electrical",
    noun: "",
    match: /wire|cable|connector|fuse|breaker|spark\s*max|talon|roborio|\bpdh\b|\bpdp\b|battery|encoder|sensor|limelight|candle|canivore/i,
    fields: [
      { id: "kind", label: "Kind", kind: "options", options: ["Wire", "Connector", "Motor controller", "Sensor", "Breaker", "Battery", "Other"], name: "" },
      { id: "size", label: "Gauge / size", kind: "text" },
    ],
  },
  {
    id: "filament",
    label: "Filament",
    noun: "Filament",
    match: /filament|\bpla\b|petg|\babs\b|onyx|\btpu\b/i,
    fields: [{ id: "material", label: "Material", kind: "material", materials: ["3D Printed"] }, { id: "color", label: "Color", kind: "text" }],
  },
  { id: "other", label: "Other", noun: "", match: null, fields: [] },
];

const MATCH = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c.match]));

// A guess from an item's name among the team's categories: the first whose name pattern fits.
export function guessCategory(name: string, categoryIds: string[]): string | null {
  for (const id of categoryIds) if (MATCH.get(id)?.test(name)) return id;
  return null;
}
