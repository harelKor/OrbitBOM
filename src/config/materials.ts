// Team 1690's materials by category, copied from FRCBOM (ref §4), with the "1.5mmm" typo fixed.
// BOM parts now pick an inventory item as their material (lib/data/materials.ts); this list only
// gives old inventory material fields (ones still naming its groups) their choices and the 3D
// colour groups.

// The base materials inventory "material" fields offer (Harel, 2026-10-30): what a thing is made
// of, never a shape or size. They seed the base_materials table; the team edits them in Settings.
export const BASE_MATERIALS = [
  "Aluminum",
  "6061-T6",
  "7075-T6",
  "Polycarbonate",
  "Carbon Fiber",
  "Steel",
  "Stainless Steel",
  "Brass",
  "Delrin / Acetal",
  "Nylon",
  "Birch",
  "Plywood",
  "MDF",
  "SRPP",
  "PLA",
  "TPU",
  "PETG",
  "Onyx",
  "PA612",
];

export type MaterialList = Record<string, string[]>;

export const MATERIALS: MaterialList = {
  "3D Printed": ["PLA", "PA612", "Onyx", "SLS", "Steel"],
  "Aluminum Extrusions": [
    "(20*20*1.5)mm",
    "(25*25*1.5)mm",
    "(25*25*3)mm",
    "(25*50*1.5)mm",
    "(25*50*3)mm",
    "(50*50*1.5)mm",
    "(50*50*3)mm",
    "(50*50*2)mm",
  ],
  "Aluminum Plates": [
    "1mm 6061-T6",
    "1.5mm 6061-T6",
    "2mm 6061-T6",
    "3mm 6061-T6",
    "4mm 6061-T6",
    "4.3mm 6061-T6",
    "5mm 6061-T6",
    "6.35mm 6061-T6",
    "6.7mm 6061-T6",
    "8mm 6061-T6",
    "10mm 6061-T6",
    "12mm 6061-T6",
  ],
  "Aluminum Tubes": [
    "(20*2)mm",
    "(25*1.5)mm",
    "(25*1)mm",
    "(25*3)mm",
    "(25*2)mm",
    "(40*2)mm",
    "(50*2)mm",
    "(70*3)mm",
    "(76*3)mm",
  ],
  COTS: ["Belts", "Gears", "Pulleys", "Sprockets"],
  "Carbon Fiber Tubes": ["(16*1.5)mm", "(16*1)mm"],
  "Existing Parts": ["From Kepler", "From Parker"],
  "Lathed Parts": [
    "1/2In HEX Shaft",
    "1/2In ThunderHEX Shaft",
    "3/8In HEX Shaft",
    "3/8In ThunderHEX Shaft",
    "8mm Aluminum Standoff",
    "10mm Aluminum Standoff",
    "Aluminum Block",
    "Steel Block",
    "Brass Block",
  ],
  "Polycarbonate Plates": [
    "1mm Poly",
    "2mm Poly",
    "3mm Poly",
    "4mm Poly",
    "5mm Poly",
    "6mm Poly",
    "8mm Poly",
    "10mm Poly",
  ],
  "Polycarbonate Tubes": ["(1.25*1.125)IN", "(1.5*1.375)IN"],
  "Wood Blocks": ["2-By-4", "2-By-2"],
  "Wood Plates": [],
};

export const allMaterials = (list: MaterialList = MATERIALS): string[] => Object.values(list).flat();

export function materialCategory(material: string, list: MaterialList = MATERIALS): string | undefined {
  for (const [category, names] of Object.entries(list)) {
    if (names.includes(material)) return category;
  }
  return undefined;
}

// Plate thickness in mm parsed from names like "6.35mm 6061-T6" or "3mm Poly"; used by
// geometry classification to map a part's smallest dimension to a material.
export function plateThicknessMm(material: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?)mm\b/.exec(material);
  return match ? Number(match[1]) : undefined;
}
