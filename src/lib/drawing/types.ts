// A drawing, laid out on its sheet (mm, y down), ready for svg.ts. Notes and dimensions carry
// stable ids so the drawing editor can hide, change or move them later.

import type { Part } from "./read";

export type Pt = [number, number];
export type Stroke = "visible" | "thin" | "center";
export type Line = { pts: Pt[]; stroke: Stroke };
// A dimension between a and b, its line drawn at y = at (horizontal) or x = at (vertical).
// `added`: placed by a member with the editor's Dimension tool (not made by the drawing).
export type Dim = { id: string; a: Pt; b: Pt; at: number; dir: "h" | "v"; text: string; added?: boolean };
// "dia": a hole's diameter dimension, a leader to its edge reading Ø<d> (Onshape draws them so).
export type NoteKind = "tap" | "fit" | "bore" | "tool" | "size" | "dia" | "custom";
// What a fit note fits: a BOM part or an inventory item, shown by name on the note's line.
export type NoteLink = { partId?: string; itemId?: string; name: string };
export type Note = { id: string; kind: NoteKind; text: string; at: Pt; leader?: Pt; link?: NoteLink; added?: boolean };

// A point on one view, in that view's own millimetres (origin bottom left, y up), so it stays on
// the same spot of the part when the drawing is laid out again at another scale. `hole` (a hole's
// face id) with `ang` (radians, sheet axes) puts it on that hole's edge wherever the hole is now.
export type Ref = { v: string; p: Pt; hole?: string; ang?: number };

// One view as placed on the sheet: `key` names it ("front", "side", "end", "long0"…), x / y its
// top-left corner, s its scale, w / h its size in the view's own mm.
export type PlacedView = { key: string; x: number; y: number; s: number; w: number; h: number };

// The BOM block, bottom right, filled by the caller from the part's BOM row. The name is the
// part's number too.
export type TitleBlock = {
  name: string;
  material?: string;
  processes?: string[];
  quantity?: number;
  system?: string;
  robot?: string;
  revision?: string;
  date?: string;
};

export type Drawing = {
  kind: Part["kind"];
  sheet: { w: number; h: number };
  lines: Line[];
  dims: Dim[];
  notes: Note[];
  title: TitleBlock;
  stock: string; // e.g. "6.7 mm plate"
  views: PlacedView[];
  holes: { id: string; view: string; at: Pt; r: number; d: number }[]; // every hole drawn, sheet mm, for the editor
  // What the editor's Dimension tool snaps to: corners and line ends, hole centres, straight edges.
  snaps: { at: Pt; view: string; kind: "vertex" | "center" }[];
  edges: { a: Pt; b: Pt; view: string }[];
  image?: { href: string; x: number; y: number; w: number; h: number }; // the part's 3D thumbnail
};
