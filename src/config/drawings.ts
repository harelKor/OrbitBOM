// Fabrication drawing rules (plan/auto-drawings.md). Only taps and fits are noted on a drawing.

// A hole matches a size when its diameter is within this many mm.
export const HOLE_MATCH_MM = 0.05;

// Tap drill diameters noted as a tap.
export const TAPS = [{ drillMm: 4.2, note: "M5 tapped" }];

// Screws a hole can be noted as tapped for in the drawing editor.
export const SCREWS = ["M4", "M5", "M6"] as const;

// Bearing bores that get a fit note.
export const BEARINGS = [
  { boreMm: 28.7, name: "1/2IN HEX Bearing" },
  { boreMm: 22.35, name: "3/8IN HEX Bearing" },
  { boreMm: 16.1, name: "8x16x5 Radial Bearing" },
];

export const FITS = ["light press", "heavy press", "slip", "precise slip"] as const;
export type Fit = (typeof FITS)[number];
export const DEFAULT_FIT: Fit = "light press";

// Ink on the sheet, in grayscale (it prints on any printer). The part's own lines are a dark grey
// so the dimension and note arrows, in solid black and drawn heavier, stand out from them.
export const INK = {
  part: "#4d4d4d", // visible edges
  center: "#808080", // centre marks and chain lines
  annotation: "#000", // dimension, extension and leader lines, arrowheads and their text
  annotationWidth: 0.35, // mm, dimension and leader lines (ISO thin is 0.25)
  arrowLength: 4, // mm
  arrowHalfWidth: 1.1, // mm, half the arrowhead's base
};
