// Onshape custom part properties the BOM reads (ref §6). FRCBOM stores these as
// material_property_id / preprocess_property_id / process1_property_id / process2_property_id.
// The IDs come from the team's Enterprise custom-property list; the Onshape test script
// (scripts/onshape-test.ts) prints every BOM column with its propertyId so they can be filled in.
// An empty ID falls back to matching the BOM column by name.

export const ONSHAPE_PROPERTIES = {
  material: { id: "", name: "Material" },
  preProcess: { id: "", name: "Pre Process" },
  process1: { id: "", name: "Process 1" },
  process2: { id: "", name: "Process 2" },
} as const;
