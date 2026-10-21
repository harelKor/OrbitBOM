import { MATERIALS, materialCategory } from "./materials";

// Default 3D colour of each material category; the team can change them from the right
// panel in Edit mode (stored in material_colors). Parts whose material isn't on the list
// fall under OTHER, parts with no material under NONE.
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

export const MATERIAL_COLOR_GROUPS = [...Object.keys(MATERIALS), OTHER_MATERIAL, NO_MATERIAL];

// The colour group a part's material falls in.
export function materialColorGroup(material: string | null | undefined): string {
  if (!material) return NO_MATERIAL;
  return materialCategory(material) ?? (material in MATERIALS ? material : OTHER_MATERIAL);
}

export function materialColor(material: string | null | undefined, overrides: Record<string, string>): string {
  const group = materialColorGroup(material);
  return overrides[group] ?? DEFAULT_MATERIAL_COLORS[group] ?? DEFAULT_MATERIAL_COLORS[OTHER_MATERIAL];
}
