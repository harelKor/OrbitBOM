// A drawing, laid out on its sheet (mm, y down), ready for svg.ts. Notes carry stable ids so the
// drawing editor can hide, change or move them later.

export type Pt = [number, number];
export type Stroke = "visible" | "thin" | "center";
export type Line = { pts: Pt[]; stroke: Stroke };
// A horizontal dimension between a and b, its line drawn at y.
export type Dim = { a: Pt; b: Pt; y: number; text: string };
export type NoteKind = "tap" | "fit" | "tool" | "custom";
export type Note = { id: string; kind: NoteKind; text: string; at: Pt; leader?: Pt };

// The BOM block, bottom right. Filled by the caller from the part's BOM row.
export type TitleBlock = {
  name: string;
  partNumber?: string;
  material?: string;
  processes?: string[];
  quantity?: number;
  system?: string;
  robot?: string;
  revision?: string;
  date?: string;
  designer?: string;
};

export type Drawing = {
  kind: "plate";
  sheet: { w: number; h: number };
  scale: number;
  lines: Line[];
  dims: Dim[];
  notes: Note[];
  title: TitleBlock;
  stock: string; // e.g. "6.7 mm plate"
  image?: { href: string; x: number; y: number; w: number; h: number }; // the part's 3D thumbnail
};
