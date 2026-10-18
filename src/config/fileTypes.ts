// Part file types (ref §4). Drawings come from Onshape links; the rest are uploads to R2.

export const PART_FILE_TYPES = [
  { id: "drawing", label: "Drawing" },
  { id: "gcode", label: "Gcode" },
  { id: "image", label: "Image" },
  { id: "flattened", label: "Flattened" },
] as const;

export type PartFileType = (typeof PART_FILE_TYPES)[number]["id"];

export const STL_QUALITIES = ["Draft", "Standard", "Fine", "Ultra"] as const;
export const DEFAULT_STL_QUALITY = "Standard";
