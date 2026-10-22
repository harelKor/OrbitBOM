// Inventory part types, built into the app (Harel: no user-made types, so each type can get its
// own UI and Claude knows every type's fields). Copied from FRCBOM (ref §5); edit here.
// A field with `options` is a dropdown; otherwise free text. `namePattern` builds the item name.
// `sheet` items are counted in whole sheets and pieces of one (¼ ⅓ ½ ⅔ ¾).

export type PartTypeField = { id: string; label: string; options?: string[] };
export type NameToken = { field: string } | { text: string } | { material: true };

export type PartTypeDef = {
  id: string;
  name: string;
  fields: PartTypeField[];
  materialSource?: string; // a category in materials.ts
  namePattern?: NameToken[];
  sheet?: boolean;
};

const BORES = ["1/2In HEX", "3/8In HEX", "SplineXS", "SplineXL"];
const PITCHES = ["GT2-3", "HTD-5"];

export const PART_TYPES: PartTypeDef[] = [
  {
    id: "pulleys",
    name: "Pulleys",
    fields: [
      { id: "teeth", label: "Teeth" },
      { id: "thickness", label: "Thickness" },
      { id: "bore", label: "Bore", options: BORES },
      { id: "pitch", label: "Pitch", options: PITCHES },
      { id: "otherBore", label: "Other Bore" },
    ],
    namePattern: [
      { field: "teeth" },
      { text: "T " },
      { field: "pitch" },
      { text: ", " },
      { field: "thickness" },
      { text: "mm Wide " },
      { field: "bore" },
      { field: "otherBore" },
      { text: " Pulley" },
    ],
  },
  {
    id: "gears",
    name: "Gears",
    fields: [
      { id: "dp", label: "DP" },
      { id: "teeth", label: "Teeth" },
      { id: "thickness", label: "Thickness" },
      { id: "bore", label: "Bore", options: BORES },
      { id: "otherBore", label: "Other Bore" },
    ],
  },
  {
    id: "radial-bearings",
    name: "Radial Bearings",
    fields: [
      { id: "od", label: "OD" },
      { id: "id", label: "ID" },
      { id: "thickness", label: "Thickness" },
      { id: "bore", label: "Bore", options: BORES },
    ],
  },
  {
    id: "flanged-bearings",
    name: "Flanged Bearings",
    fields: [
      { id: "id", label: "ID" },
      { id: "od", label: "OD" },
      { id: "thickness", label: "Thickness" },
      { id: "bore", label: "Bore" },
      { id: "flangeOd", label: "Flange OD" },
      { id: "flangeThickness", label: "Flange Thickness" },
    ],
  },
  {
    id: "aluminum-plates",
    name: "Aluminum Plates",
    sheet: true,
    fields: [
      { id: "x", label: "(X)mm" },
      { id: "y", label: "(Y)mm" },
      { id: "otherMaterial", label: "Other Material" },
    ],
    materialSource: "Aluminum Plates",
  },
  {
    id: "filament",
    name: "Filament",
    fields: [
      { id: "otherMaterial", label: "Other Material" },
      { id: "vendor", label: "Vendor" },
      { id: "spoolWeight", label: "Spool Weight" },
    ],
    materialSource: "3D Printed",
  },
  {
    id: "aluminum-extrusions",
    name: "Aluminum Extrusions",
    fields: [{ id: "length", label: "Length" }],
    materialSource: "Aluminum Extrusions",
  },
  {
    id: "belts",
    name: "Belts",
    fields: [
      { id: "teeth", label: "Teeth" },
      { id: "width", label: "Width" },
      { id: "pitch", label: "Pitch", options: PITCHES },
    ],
  },
  {
    id: "polycarbonate-plates",
    name: "Polycarbonate Plates",
    sheet: true,
    fields: [
      { id: "sizeX", label: "Size X" },
      { id: "sizeY", label: "Size Y" },
      { id: "otherMaterial", label: "Other Material" },
    ],
    materialSource: "Polycarbonate Plates",
  },
  {
    id: "polycarbonate-tubes",
    name: "Polycarbonate Tubes",
    fields: [{ id: "length", label: "Length" }],
    materialSource: "Polycarbonate Tubes",
  },
  {
    id: "sprockets",
    name: "Sprockets",
    fields: [
      { id: "teeth", label: "Teeth" },
      { id: "bore", label: "Bore", options: BORES },
      { id: "type", label: "Type", options: ["#35", "#25"] },
      { id: "otherBore", label: "Other Bore" },
    ],
  },
  {
    id: "aluminum-tubes",
    name: "Aluminum Tubes",
    fields: [{ id: "length", label: "Length" }],
    materialSource: "Aluminum Tubes",
  },
  {
    id: "silicone-tubing",
    name: "SiliconeTubing",
    fields: [
      { id: "length", label: "Length" },
      { id: "diameter", label: "Diameter" },
    ],
  },
  {
    id: "wires",
    name: "Wires",
    fields: [
      { id: "awg", label: "Awg" },
      { id: "lengthMm", label: "Length mm" },
      { id: "lengthM", label: "length m" },
    ],
  },
];

export function getPartType(id: string): PartTypeDef | undefined {
  return PART_TYPES.find((t) => t.id === id);
}

export function buildItemName(
  type: PartTypeDef,
  values: Record<string, string>,
  material?: string,
): string | undefined {
  if (!type.namePattern) return undefined;
  return type.namePattern
    .map((t) => ("field" in t ? (values[t.field] ?? "") : "text" in t ? t.text : (material ?? "")))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

export const isSheetType = (id: string | null | undefined) => !!id && !!getPartType(id)?.sheet;
