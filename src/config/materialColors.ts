import { MATERIALS, materialCategory, type MaterialList } from "./materials";

// The 3D colour of each material category, for Material mode and a thumbnail's material
// button (rows in material_colors override them). Parts whose material isn't on the list
// take the colour of Onshape's material, else OTHER; parts with no material at all NONE.
export const OTHER_MATERIAL = "Other";
export const NO_MATERIAL = "No material";

export const DEFAULT_MATERIAL_COLORS: Record<string, string> = {
  "3D Printed": "#3f444d",
  "Aluminum Extrusions": "#a7aeb8",
  "Aluminum Plates": "#a7aeb8",
  "Aluminum Tubes": "#a7aeb8",
  COTS: "#c8962e",
  "Carbon Fiber Tubes": "#1c1d21",
  "Existing Parts": "#2a9d8f",
  "Lathed Parts": "#5d7fa3",
  "Polycarbonate Plates": "#9fdcf5",
  "Polycarbonate Tubes": "#9fdcf5",
  "Wood Blocks": "#b07a45",
  "Wood Plates": "#c99a62",
  [OTHER_MATERIAL]: "#d8644a",
  [NO_MATERIAL]: "#e2e5ea",
};

export const materialColorGroups = (list: MaterialList = MATERIALS) => [...Object.keys(list), OTHER_MATERIAL, NO_MATERIAL];

// Onshape's own material names (and BOM materials typed off the list) by the category whose
// colour they take.
const ONSHAPE_MATERIALS: [RegExp, string][] = [
  [/alumin/i, "Aluminum Plates"],
  [/polycarb|lexan/i, "Polycarbonate Plates"],
  [/carbon|\bcf\b/i, "Carbon Fiber Tubes"],
  [/\b(pla|petg|abs|asa|tpu|onyx|nylon|pa ?6?12|resin|sls)\b|print/i, "3D Printed"],
  [/wood|plywood|\bmdf\b|birch/i, "Wood Plates"],
  [/steel|brass|bronze|iron|copper/i, "Lathed Parts"],
];

// The colour group a part's material falls in. With no BOM material, Onshape's material
// decides.
export function materialColorGroup(material: string | null | undefined, onshapeMaterial?: string | null, list: MaterialList = MATERIALS): string {
  if (!material && !onshapeMaterial) return NO_MATERIAL;
  const listed = material && (materialCategory(material, list) ?? (material in list ? material : undefined));
  if (listed) return listed;
  for (const name of [material, onshapeMaterial]) {
    const match = name && ONSHAPE_MATERIALS.find(([re]) => re.test(name));
    if (match) return match[1];
  }
  return OTHER_MATERIAL;
}

export function materialColor(material: string | null | undefined, overrides: Record<string, string>, onshapeMaterial?: string | null, list: MaterialList = MATERIALS): string {
  const group = materialColorGroup(material, onshapeMaterial, list);
  return overrides[group] ?? DEFAULT_MATERIAL_COLORS[group] ?? DEFAULT_MATERIAL_COLORS[OTHER_MATERIAL];
}
