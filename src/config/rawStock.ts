// The robot's Raw stock planner (Harel, 2026-11-07): every plate, tube and box tube part of a
// robot laid out on stock pieces of one size, to decide how much raw stock to prepare. Sizes use
// the inventory's piece keys (src/lib/inventory/stock.ts): "p500x900" a plate, "m1000" a length.

// Piece sizes offered for every group, next to the sizes its inventory item has on the shelf.
export const PLATE_PRESETS = ["p500x900", "p600x1000", "p1000x1200", "p1220x2440"];
export const LENGTH_PRESETS = ["m1000", "m1500", "m2000", "m3000"];

// Between plate parts and around the sheet (router), mm: To Fab's Auto Layout defaults.
export const PLATE_GAP = 8;
export const PLATE_MARGIN = 10;
// Lost to each saw cut on a tube or shaft, mm.
export const SAW_KERF = 3;

// Raw Stock categories that aren't laid out on pieces: they stay in the robot's item list
// (Harel, 2026-11-07).
export const NOT_LAID_OUT = ["filament", "cylinders-blocks"];

// A part counts as made from its stock once it reaches Post Processing or any status after it
// (Harel, 2026-11-07). In Factory sits after it in the list but is made elsewhere, not yet done.
export const MADE_FROM = "Post Processing";
export const NOT_MADE = ["In Factory"];
