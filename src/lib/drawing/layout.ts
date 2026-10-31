// A part's views, sizes and notes laid out on an A4 sheet (plan/auto-drawings.md). Only taps,
// fits and the sizes Harel's standards ask for are noted; holes get centre marks only.

import { BEARINGS, DEFAULT_FIT, HOLE_MATCH_MM, TAPS, TOOLS } from "@/config/drawings";
import type { DrawingEdits } from "@/db/schema";
import type { Hole, Part, View } from "./read";
import type { Dim, Drawing, Line, Note, Pt, TitleBlock } from "./types";

export const SHEET = { w: 297, h: 210 }; // A4 landscape
export const MARGIN = 10;
export const TITLE = { w: 120, h: 36 };
// Largest first: a part is drawn at the biggest scale that fits, so it fills the sheet.
const SCALES = [4, 3, 2.5, 2, 1.5, 1.25, 1, 0.85, 0.75, 0.65, 0.6, 0.5, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1];
const GAP = 22;
// Room left around the views for their dimensions and notes.
const AREA = { x0: MARGIN + 10, x1: SHEET.w - MARGIN - 12, y0: MARGIN + 22, y1: SHEET.h - MARGIN - TITLE.h - 10 };

export const fmt = (n: number) => String(Math.round(n * 100) / 100);
const near = (a: number, b: number) => Math.abs(a - b) <= HOLE_MATCH_MM;

type Placed = { view: View; x: number; y: number; s: number }; // top-left corner on the sheet
const toSheet = (p: Placed, [px, py]: [number, number]): Pt => [p.x + px * p.s, p.y + (p.view.h - py) * p.s];
const box = (p: Placed) => ({ x0: p.x, y0: p.y, x1: p.x + p.view.w * p.s, y1: p.y + p.view.h * p.s });

// Long views stacked on the left, the end view (or side view, for plates) beside them. A small
// end view gets a bigger scale of its own so its sizes stay readable.
function arrange(main: View[], beside: View, besideLeft: boolean): Placed[] {
  for (const s of SCALES) {
    const big = Math.max(beside.w, beside.h);
    const bs = besideLeft ? s : Math.max(s, SCALES.find((x) => big * x <= 45) ?? s);
    const mainW = Math.max(...main.map((v) => v.w)) * s;
    const mainH = main.reduce((t, v) => t + v.h * s, 0) + GAP * (main.length - 1);
    const width = mainW + GAP + beside.w * bs;
    const height = Math.max(mainH, beside.h * bs);
    const last = s === SCALES[SCALES.length - 1];
    if (!last && (width > AREA.x1 - AREA.x0 || height > AREA.y1 - AREA.y0)) continue;
    const x = AREA.x0 + (AREA.x1 - AREA.x0 - width) / 2;
    const y = AREA.y0 + (AREA.y1 - AREA.y0 - height) / 2;
    const mx = besideLeft ? x + beside.w * bs + GAP : x;
    let my = y + (height - mainH) / 2;
    const placed = main.map((view) => {
      const p = { view, x: mx, y: my, s };
      my += view.h * s + GAP;
      return p;
    });
    const bx = besideLeft ? x : x + mainW + GAP;
    return [...placed, { view: beside, x: bx, y: y + (height - beside.h * bs) / 2, s: bs }];
  }
  throw new Error("unreachable");
}

function viewLines(p: Placed): Line[] {
  const lines: Line[] = p.view.lines.map((l) => ({ pts: l.map((pt) => toSheet(p, pt)), stroke: "visible" }));
  for (const h of p.view.holes) {
    const [cx, cy] = toSheet(p, h.at);
    const r = (h.d / 2) * p.s + 2;
    const stroke = r < 6 ? "thin" : "center"; // a chain line too short to show its dash is drawn plain
    lines.push({ pts: [[cx - r, cy], [cx + r, cy]], stroke }, { pts: [[cx, cy - r], [cx, cy + r]], stroke });
  }
  if (p.view.axis) {
    const b = box(p);
    const y = (b.y0 + b.y1) / 2;
    lines.push({ pts: [[b.x0 - 3, y], [b.x1 + 3, y]], stroke: "center" });
  }
  return lines;
}

type Rect = { x0: number; y0: number; x1: number; y1: number };
const CHAR = 1.9; // mm per character of 3.5 mm lettering
const ROW = 3.5 * 1.3;
const hits = (a: Rect, b: Rect, pad = 1.5) => a.x0 < b.x1 + pad && a.x1 + pad > b.x0 && a.y0 < b.y1 + pad && a.y1 + pad > b.y0;
// Whether the segment p→q crosses the rectangle (sampled: the rectangles are text-sized).
const crosses = (p: Pt, q: Pt, r: Rect) => {
  for (let i = 1; i < 20; i++) {
    const [x, y] = [p[0] + ((q[0] - p[0]) * i) / 20, p[1] + ((q[1] - p[1]) * i) / 20];
    if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) return true;
  }
  return false;
};
// Where a note's text sits (its first baseline at `at`) and where its leader leaves it, as svg.ts
// draws them.
export function noteBox(text: string, at: Pt, leader?: Pt): { rect: Rect; end?: Pt } {
  const rows = text.split("\n");
  const width = Math.max(...rows.map((l) => l.length)) * CHAR;
  const rect = { x0: at[0], y0: at[1] - 3.5, x1: at[0] + width, y1: at[1] + (rows.length - 1) * ROW + 1.2 };
  if (!leader) return { rect };
  const below = leader[1] < at[1];
  return { rect, end: [at[0] + width / 2, below ? rect.y0 : rect.y1] };
}
// The text of a dimension, as svg.ts draws it.
export function dimRect(d: Dim): Rect {
  const v = d.dir === "v";
  const [a, b] = v ? [d.a[1], d.b[1]] : [d.a[0], d.b[0]];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const w = d.text.length * CHAR;
  const along = hi - lo < 10 ? (v ? [lo - 12 - w, lo - 12] : [hi + 12, hi + 12 + w]) : [(lo + hi) / 2 - w / 2, (lo + hi) / 2 + w / 2];
  const off = hi - lo < 10 && !v ? [d.at + 1.2 - 3.5, d.at + 1.2] : [d.at - 4.5, d.at - 1];
  return v ? { x0: off[0], x1: off[1], y0: along[0], y1: along[1] } : { x0: along[0], x1: along[1], y0: off[0], y1: off[1] };
}
// The dimension line itself, a thin strip.
function dimLine(d: Dim): Rect {
  const v = d.dir === "v";
  const [a, b] = v ? [d.a[1], d.b[1]] : [d.a[0], d.b[0]];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return v ? { x0: d.at - 0.5, x1: d.at + 0.5, y0: lo, y1: hi } : { x0: lo, x1: hi, y0: d.at - 0.5, y1: d.at + 0.5 };
}

// Notes go above or below their view, nearest the hole, wherever they clear the views, the
// dimensions, the BOM block and the other notes, and where their leader crosses no text.
function noter(views: Placed[], dims: Dim[]) {
  const solid: Rect[] = [
    ...views.map(box),
    ...dims.map(dimLine),
    { x0: SHEET.w - MARGIN - TITLE.w, y0: SHEET.h - MARGIN - TITLE.h, x1: SHEET.w - MARGIN, y1: SHEET.h - MARGIN },
    { x0: MARGIN, y0: SHEET.h - MARGIN - 12, x1: MARGIN + 150, y1: SHEET.h - MARGIN }, // the max tool note
  ];
  const text: Rect[] = dims.map(dimRect);
  const inSheet = (r: Rect) => r.x0 >= MARGIN + 3 && r.x1 <= SHEET.w - MARGIN - 3 && r.y0 >= MARGIN + 3 && r.y1 <= SHEET.h - MARGIN - 3;
  return (p: Placed, h: Hole, words: string): { leader: Pt; at: Pt } => {
    const c = toSheet(p, h.at);
    const r = (h.d / 2) * p.s;
    const b = box(p);
    const rows = words.split("\n");
    const width = Math.max(...rows.map((l) => l.length)) * CHAR;
    const height = rows.length * ROW;
    const prefer = c[1] <= (b.y0 + b.y1) / 2 ? -1 : 1;
    const leaderTo = (at: Pt, toward: Pt): Pt => {
      const [dx, dy] = [toward[0] - c[0], toward[1] - c[1]];
      const l = Math.hypot(dx, dy) || 1;
      return [c[0] + (dx / l) * r, c[1] + (dy / l) * r];
    };
    let first: { leader: Pt; at: Pt } | undefined;
    for (const side of [prefer, -prefer])
      for (let step = 0; step < 12; step++)
        for (const shift of [0, -12, 12, -24, 24, -40, 40, -60, 60]) {
          const x = Math.min(Math.max(c[0] - width / 2 + 8 + shift, MARGIN + 4), SHEET.w - MARGIN - 4 - width);
          const y = side < 0 ? b.y0 - 10 - height + 3.5 - step * 4 : b.y1 + 12 + step * 4;
          const at: Pt = [x, y];
          const guess = noteBox(words, at, side < 0 ? [c[0], b.y1] : [c[0], b.y0]);
          const leader = leaderTo(at, guess.end!);
          const { rect, end } = noteBox(words, at, leader);
          const option = { leader, at };
          first ??= option;
          if (!inSheet(rect) || solid.some((o) => hits(rect, o)) || text.some((o) => hits(rect, o) || crosses(end!, leader, o))) continue;
          text.push(rect);
          return option;
        }
    text.push(noteBox(words, first!.at, first!.leader).rect);
    return first!;
  };
}

// Tap and bearing fit notes for the holes seen in these views; every other hole gets none.
function holeNotes(views: Placed[], place: ReturnType<typeof noter>, ends?: Placed): Note[] {
  const notes: Note[] = [];
  const seen = new Set<string>();
  for (const p of views) {
    for (const tap of TAPS) {
      const holes = p.view.holes.filter((h) => near(h.d, tap.drillMm) && !seen.has(h.faceId));
      if (!holes.length) continue;
      holes.forEach((h) => seen.add(h.faceId));
      const both = holes.every((h) => h.both) ? (p === ends ? ", both ends" : ", both sides") : "";
      const text = `${holes.length > 1 ? `${holes.length}× ` : ""}${tap.note}${both}`;
      notes.push({ id: `tap:${tap.drillMm}:${holes[0].faceId}`, kind: "tap", text, ...place(p, holes[0], text) });
    }
    for (const h of p.view.holes) {
      const bearing = BEARINGS.find((b) => near(h.d, b.boreMm));
      if (!bearing || seen.has(h.faceId)) continue;
      seen.add(h.faceId);
      const text = `${DEFAULT_FIT} fit for\n${bearing.name}\nØ${fmt(h.d)}`;
      notes.push({ id: `fit:${h.faceId}`, kind: "fit", text, ...place(p, h, text) });
    }
  }
  return notes;
}

// The biggest shop endmill that fits the tightest inner corner (TOOLS); smaller than every one,
// the corner's raw diameter, so the shop sees it needs a special tool.
export function maxToolText(r: number): string {
  const tool = TOOLS.filter((t) => t.mm <= 2 * r + 1e-6).sort((a, b) => b.mm - a.mm)[0];
  return `Max tool ${tool ? tool.label : `Ø${fmt(2 * r)}`} (inner corners R${fmt(r)})`;
}
const toolNote = (r?: number): Note[] => (r ? [{ id: "tool", kind: "tool", text: maxToolText(r), at: [MARGIN + 5, SHEET.h - MARGIN - 6] }] : []);

// A horizontal dimension across the top of a view, or a vertical one down its right side.
const across = (p: Placed, text: string, below = false): Dim => {
  const b = box(p);
  const y = below ? b.y1 : b.y0;
  return { a: [b.x0, y], b: [b.x1, y], at: below ? y + 8 : y - 8, dir: "h", text };
};
const down = (p: Placed, text: string): Dim => {
  const b = box(p);
  return { a: [b.x1, b.y0], b: [b.x1, b.y1], at: b.x1 + 8, dir: "v", text };
};

export function partDrawing(part: Part, title: TitleBlock, image?: string): Drawing {
  let placed: Placed[];
  let dims: Dim[] = [];
  let notes: Note[] = [];
  let stock: string;

  if (part.kind === "plate") {
    placed = arrange([part.front], part.side, true);
    const [front, side] = placed;
    dims = [across(side, fmt(part.thickness))];
    notes = [...holeNotes([front], noter(placed, dims)), ...toolNote(part.minInnerRadius)];
    stock = `${fmt(part.thickness)} mm plate`;
  } else if (part.kind === "square-tube") {
    placed = arrange(part.long, part.end, false);
    const end = placed[placed.length - 1];
    const [x, y] = part.size;
    dims = [across(placed[0], fmt(part.length)), across(end, fmt(x), true), down(end, fmt(y))];
    if (part.wall) {
      const b = box(end);
      dims.push({ a: [b.x0, b.y0], b: [b.x0 + part.wall * end.s, b.y0], at: b.y0 - 8, dir: "h", text: fmt(part.wall) });
    }
    notes = [...holeNotes(placed, noter(placed, dims), end), ...toolNote(part.minInnerRadius)];
    stock = `${fmt(x)}×${fmt(y)}${part.wall ? `×${fmt(part.wall)}` : ""} tube, ${fmt(part.length)} long`;
  } else if (part.kind === "hex-shaft") {
    placed = arrange([part.side], part.end, false);
    const [side, end] = placed;
    dims = [across(side, fmt(part.length)), down(end, fmt(part.acrossFlats))];
    const bore = end.view.holes[0];
    if (bore) {
      const tap = TAPS.find((t) => near(bore.d, t.drillMm));
      const text = tap ? tap.note : `Ø${fmt(bore.d)}`;
      notes = [{ id: `bore:${bore.faceId}`, kind: "bore", text, ...noter(placed, dims)(end, bore, text) }];
    }
    stock = `${fmt(part.acrossFlats)} hex, ${fmt(part.length)} long`;
  } else {
    placed = arrange([part.side], part.end, false);
    const [side, end] = placed;
    const b = box(end);
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    dims = [across(side, fmt(part.length)), across(end, `Ø${fmt(part.od)}`, true)];
    if (part.id) {
      const r = (part.id / 2) * end.s;
      dims.push({ a: [cx - r, cy], b: [cx + r, cy], at: b.y0 - 8, dir: "h", text: `Ø${fmt(part.id)}` });
      notes = [{ id: "wall", kind: "size", text: `Wall ${fmt((part.od - part.id) / 2)}`, at: [b.x0, b.y1 + 18] }];
    }
    stock = `Ø${fmt(part.od)}${part.id ? `×${fmt((part.od - part.id) / 2)}` : ""} tube, ${fmt(part.length)} long`;
  }

  return {
    kind: part.kind,
    sheet: SHEET,
    lines: placed.flatMap(viewLines),
    holes: placed.flatMap((p) => p.view.holes.map((h) => ({ id: h.faceId, at: toSheet(p, h.at), r: (h.d / 2) * p.s, d: h.d }))),
    dims,
    notes,
    title,
    stock,
    ...(image ? { image: { href: image, x: MARGIN + 4, y: MARGIN + 4, w: 50, h: 38 } } : {}),
  };
}

// The member's edits on top of the automatic notes: hidden, retyped or moved notes (text and arrow apart), and notes
// they added.
export function applyEdits(d: Drawing, e: DrawingEdits): Drawing {
  const hidden = new Set(e.hidden ?? []);
  const notes: Note[] = d.notes
    .filter((n) => !hidden.has(n.id))
    .map((n) => ({
      ...n,
      ...(e.text?.[n.id] != null ? { text: e.text[n.id] } : {}),
      ...(e.moved?.[n.id] ? { at: e.moved[n.id] } : {}),
      ...(e.arrows?.[n.id] ? { leader: e.arrows[n.id] } : {}),
    }));
  for (const a of e.added ?? []) notes.push({ id: a.id, kind: "custom", text: a.text, at: a.at, ...(a.leader ? { leader: a.leader } : {}) });
  return { ...d, notes };
}
