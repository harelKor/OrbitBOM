// A part's views, sizes and notes laid out on an A4 sheet (plan/auto-drawings.md). Only taps,
// fits and the sizes Harel's standards ask for are noted; holes get centre marks only.

import { BEARINGS, DEFAULT_FIT, HOLE_MATCH_MM, TAPS } from "@/config/drawings";
import type { DrawingEdits } from "@/db/schema";
import type { Hole, Part, View } from "./read";
import type { Dim, Drawing, Line, Note, Pt, TitleBlock } from "./types";

export const SHEET = { w: 297, h: 210 }; // A4 landscape
export const MARGIN = 10;
export const TITLE = { w: 120, h: 36 };
const SCALES = [2, 1, 0.5, 0.2, 0.1];
const GAP = 30;
const AREA = { x0: MARGIN + 15, x1: SHEET.w - MARGIN - 15, y0: MARGIN + 28, y1: SHEET.h - MARGIN - TITLE.h - 16 };

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

// Notes sit above or below their view, nearest the hole, stacked when they would overlap; the
// leader runs from the note to the hole's edge.
function noter() {
  const placed: { above: boolean; x0: number; x1: number; y: number }[] = [];
  return (p: Placed, h: Hole, text: string): { leader: Pt; at: Pt } => {
    const c = toSheet(p, h.at);
    const r = (h.d / 2) * p.s;
    const b = box(p);
    const above = c[1] <= (b.y0 + b.y1) / 2;
    const rows = text.split("\n");
    const width = Math.max(...rows.map((l) => l.length)) * 1.9;
    const x0 = Math.min(Math.max(c[0] - width / 2 + 8, MARGIN + 4), SHEET.w - MARGIN - 4 - width);
    const height = rows.length * 3.5 * 1.3;
    let y = above ? b.y0 - 12 - height + 3.5 : b.y1 + 12;
    for (const q of placed)
      if (q.above === above && x0 < q.x1 + 3 && x0 + width > q.x0 - 3) y = above ? Math.min(y, q.y - height - 3) : Math.max(y, q.y + height + 3);
    placed.push({ above, x0, x1: x0 + width, y });
    const toward: Pt = [x0 + width / 2, above ? y + height - 3.5 : y - 3.5];
    const [dx, dy] = [toward[0] - c[0], toward[1] - c[1]];
    const l = Math.hypot(dx, dy) || 1;
    return { leader: [c[0] + (dx / l) * r, c[1] + (dy / l) * r], at: [x0, y] };
  };
}

// Tap and bearing fit notes for the holes seen in these views; every other hole gets none.
function holeNotes(views: Placed[], place: ReturnType<typeof noter>): Note[] {
  const notes: Note[] = [];
  const seen = new Set<string>();
  for (const p of views) {
    for (const tap of TAPS) {
      const holes = p.view.holes.filter((h) => near(h.d, tap.drillMm) && !seen.has(h.faceId));
      if (!holes.length) continue;
      holes.forEach((h) => seen.add(h.faceId));
      const text = `${holes.length > 1 ? `${holes.length}× ` : ""}${tap.note}`;
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

const toolNote = (r?: number): Note[] =>
  r ? [{ id: "tool", kind: "tool", text: `Max tool Ø${fmt(2 * r)} (inner corners R${fmt(r)})`, at: [MARGIN + 5, SHEET.h - MARGIN - 6] }] : [];

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
  const place = noter();
  let placed: Placed[];
  let dims: Dim[] = [];
  let notes: Note[] = [];
  let stock: string;

  if (part.kind === "plate") {
    placed = arrange([part.front], part.side, true);
    const [front, side] = placed;
    dims = [across(side, fmt(part.thickness))];
    notes = [...holeNotes([front], place), ...toolNote(part.minInnerRadius)];
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
    notes = [...holeNotes(placed.slice(0, -1), place), ...toolNote(part.minInnerRadius)];
    stock = `${fmt(x)}×${fmt(y)}${part.wall ? `×${fmt(part.wall)}` : ""} tube, ${fmt(part.length)} long`;
  } else if (part.kind === "hex-shaft") {
    placed = arrange([part.side], part.end, false);
    const [side, end] = placed;
    dims = [across(side, fmt(part.length)), down(end, fmt(part.acrossFlats))];
    const bore = end.view.holes[0];
    if (bore) {
      const tap = TAPS.find((t) => near(bore.d, t.drillMm));
      const text = tap ? tap.note : `Ø${fmt(bore.d)}`;
      notes = [{ id: `bore:${bore.faceId}`, kind: "bore", text, ...place(end, bore, text) }];
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
    dims,
    notes,
    title,
    stock,
    ...(image ? { image: { href: image, x: MARGIN + 4, y: MARGIN + 4, w: 50, h: 38 } } : {}),
  };
}

// The member's edits on top of the automatic notes: hidden, retyped or moved notes, and notes
// they added.
export function applyEdits(d: Drawing, e: DrawingEdits): Drawing {
  const hidden = new Set(e.hidden ?? []);
  const notes: Note[] = d.notes
    .filter((n) => !hidden.has(n.id))
    .map((n) => ({ ...n, ...(e.text?.[n.id] != null ? { text: e.text[n.id] } : {}), ...(e.moved?.[n.id] ? { at: e.moved[n.id] } : {}) }));
  for (const a of e.added ?? []) notes.push({ id: a.id, kind: "custom", text: a.text, at: a.at, ...(a.leader ? { leader: a.leader } : {}) });
  return { ...d, notes };
}
