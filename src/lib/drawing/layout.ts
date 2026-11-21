// A part's views, sizes and notes laid out on an A4 sheet (plan/auto-drawings.md). Only taps,
// fits and the sizes Harel's standards ask for are noted; holes get centre marks only.

import { BEARINGS, DEFAULT_FIT, HOLE_MATCH_MM, TAPS, TOOLS } from "@/config/drawings";
import type { DrawingEdits } from "@/db/schema";
import type { ExtraView } from "./extra";
import type { Hole, Part, View } from "./read";
import type { Dim, DimDir, Drawing, Line, Note, PlacedView, Pt, Ref, TitleBlock } from "./types";

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

type Placed = { key: string; view: View; x: number; y: number; s: number; r?: number; href?: string }; // top-left corner on the sheet
const toSheet = (p: Placed, [px, py]: [number, number]): Pt => [p.x + px * p.s, p.y + (p.view.h - py) * p.s];
const box = (p: Placed) => ({ x0: p.x, y0: p.y, x1: p.x + p.view.w * p.s, y1: p.y + p.view.h * p.s });

// Long views stacked on the left, the end view (or side view, for plates) beside them. A small
// end view gets a bigger scale of its own so its sizes stay readable.
function arrange(main: View[], beside: View, besideLeft: boolean, keys: { main: (i: number) => string; beside: string }): Placed[] {
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
    const placed = main.map((view, i) => {
      const p = { key: keys.main(i), view, x: mx, y: my, s };
      my += view.h * s + GAP;
      return p;
    });
    const bx = besideLeft ? x : x + mainW + GAP;
    return [...placed, { key: keys.beside, view: beside, x: bx, y: y + (height - beside.h * bs) / 2, s: bs }];
  }
  throw new Error("unreachable");
}

function viewLines(p: Placed): Line[] {
  const lines: Line[] = p.view.lines.map((l) => ({ pts: l.map((pt) => toSheet(p, pt)), stroke: "visible", view: p.key }));
  for (const h of p.view.holes) {
    const [cx, cy] = toSheet(p, h.at);
    const r = (h.d / 2) * p.s + 2;
    const stroke = r < 6 ? "thin" : "center"; // a chain line too short to show its dash is drawn plain
    lines.push({ pts: [[cx - r, cy], [cx + r, cy]], stroke, view: p.key }, { pts: [[cx, cy - r], [cx, cy + r]], stroke, view: p.key });
  }
  if (p.view.axis) {
    const b = box(p);
    const y = (b.y0 + b.y1) / 2;
    lines.push({ pts: [[b.x0 - 3, y], [b.x1 + 3, y]], stroke: "center", view: p.key });
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
// A dimension in its own frame: `along` its line (a and b at `pa`, `pb`; lo..hi between them)
// and `off` across it, where the line sits at `at`. P maps (along, off) back to the sheet and
// local does the reverse. Its text is centred at `tc` along, its baseline 1 mm off the line
// (towards the reader's "up"), turned `angle` degrees. svg.ts draws from this, and the editor
// picks and drags with it, so all three agree.
export function dimFrame(d: Dim) {
  let P: (along: number, off: number) => Pt;
  let local: (p: Pt) => [number, number];
  let pa: number, pb: number, ea: number, eb: number, angle: number;
  if (d.dir === "a") {
    let [ux, uy] = d.u ?? [d.b[0] - d.a[0], d.b[1] - d.a[1]];
    const l = Math.hypot(ux, uy) || 1;
    [ux, uy] = [ux / l, uy / l];
    // Text reads left to right, or bottom to top.
    if (ux < -1e-9 || (Math.abs(ux) <= 1e-9 && uy > 0)) [ux, uy] = [-ux, -uy];
    const [nx, ny] = [-uy, ux];
    const o = d.a;
    P = (along, off) => [o[0] + ux * along + nx * off, o[1] + uy * along + ny * off];
    local = (p) => [(p[0] - o[0]) * ux + (p[1] - o[1]) * uy, (p[0] - o[0]) * nx + (p[1] - o[1]) * ny];
    [pa, pb] = [0, local(d.b)[0]];
    // b sits off the a→b line only when the dimension measures along `u` (a turned view's).
    [ea, eb] = [0, local(d.b)[1]];
    angle = (Math.atan2(uy, ux) * 180) / Math.PI;
  } else if (d.dir === "v") {
    P = (along, off) => [off, along];
    local = (p) => [p[1], p[0]];
    [pa, pb, ea, eb, angle] = [d.a[1], d.b[1], d.a[0], d.b[0], -90];
  } else {
    P = (along, off) => [along, off];
    local = (p) => [p[0], p[1]];
    [pa, pb, ea, eb, angle] = [d.a[0], d.b[0], d.a[1], d.b[1], 0];
  }
  const [lo, hi] = pa < pb ? [pa, pb] : [pb, pa];
  const w = d.text.length * CHAR;
  const short = hi - lo < 10;
  // Where the text sits before it's slid: centred, or past the arrows of a short dimension
  // (after it; before it on a vertical one, which reads upwards).
  const home = !short ? (lo + hi) / 2 : d.dir === "v" ? lo - 12 - w / 2 : hi + 12 + w / 2;
  const tc = home + (d.tx ?? 0);
  return { P, local, pa, pb, ea, eb, lo, hi, w, short, home, tc, angle, at: d.at };
}

const bboxOf = (pts: Pt[]): Rect => ({
  x0: Math.min(...pts.map((p) => p[0])),
  y0: Math.min(...pts.map((p) => p[1])),
  x1: Math.max(...pts.map((p) => p[0])),
  y1: Math.max(...pts.map((p) => p[1])),
});
// The text of a dimension, as svg.ts draws it.
export function dimRect(d: Dim): Rect {
  const f = dimFrame(d);
  return bboxOf([f.P(f.tc - f.w / 2, f.at - 4.5), f.P(f.tc + f.w / 2, f.at - 4.5), f.P(f.tc - f.w / 2, f.at - 1), f.P(f.tc + f.w / 2, f.at - 1)]);
}
// How far the dimension line runs along: between its arrows, out past them on a short one, and
// on under its text when the text was slid beyond them.
export function dimSpan(d: Dim): [number, number] {
  const f = dimFrame(d);
  const [lo, hi] = f.short ? [f.lo - 10, f.hi + 10] : [f.lo, f.hi];
  return [Math.min(lo, f.tc - f.w / 2 - 1), Math.max(hi, f.tc + f.w / 2 + 1)];
}
// The dimension line itself, a thin strip.
export function dimLine(d: Dim): Rect {
  const f = dimFrame(d);
  const [s0, s1] = dimSpan(d);
  return bboxOf([f.P(s0, f.at - 0.5), f.P(s1, f.at + 0.5)]);
}
// Whether a sheet point is on a dimension's text or line (the editor picks with it).
export function dimHit(d: Dim, p: Pt, pad = 1.2): boolean {
  const f = dimFrame(d);
  const [al, off] = f.local(p);
  const [s0, s1] = dimSpan(d);
  const onText = al >= f.tc - f.w / 2 - pad && al <= f.tc + f.w / 2 + pad && off >= f.at - 4.5 - pad && off <= f.at - 1 + pad;
  const onLine = al >= s0 - pad && al <= s1 + pad && Math.abs(off - f.at) <= pad;
  return onText || onLine;
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
      notes.push({ id: `tap:${tap.drillMm}:${holes[0].faceId}`, kind: "tap", text, view: p.key, ...place(p, holes[0], text) });
    }
    for (const h of p.view.holes) {
      const bearing = BEARINGS.find((b) => near(h.d, b.boreMm));
      if (!bearing || seen.has(h.faceId)) continue;
      seen.add(h.faceId);
      const text = `${DEFAULT_FIT} fit for\n${bearing.name}\nØ${fmt(h.d)}`;
      notes.push({ id: `fit:${h.faceId}`, kind: "fit", text, view: p.key, ...place(p, h, text) });
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
const across = (id: string, p: Placed, text: string, below = false): Dim => {
  const b = box(p);
  const y = below ? b.y1 : b.y0;
  return { id, a: [b.x0, y], b: [b.x1, y], at: below ? y + 8 : y - 8, dir: "h", text, view: p.key };
};
const down = (id: string, p: Placed, text: string): Dim => {
  const b = box(p);
  return { id, a: [b.x1, b.y0], b: [b.x1, b.y1], at: b.x1 + 8, dir: "v", text, view: p.key };
};

// `views`: where members put, sized and turned each view (edits.views). The views are laid out
// there, unturned; turnViews turns them once the edits are on.
// `extras`: views added with Add view (extra.ts), placed where `views` puts them.
export function partDrawing(part: Part, title: TitleBlock, views?: DrawingEdits["views"], extras: ExtraView[] = [], image?: string): Drawing {
  let placed: Placed[];
  const at = (list: Placed[]) =>
    list.map((p): Placed => {
      const o = views?.[p.key];
      if (!o || !(o.s > 0)) return p;
      return { ...p, s: o.s, x: o.cx - (p.view.w * o.s) / 2, y: o.cy - (p.view.h * o.s) / 2, ...(o.r ? { r: o.r } : {}) };
    });
  let dims: Dim[] = [];
  let notes: Note[] = [];
  let stock: string;

  if (part.kind === "plate") {
    placed = at(arrange([part.front], part.side, true, { main: () => "front", beside: "side" }));
    const [front, side] = placed;
    dims = [across("dim:thickness", side, fmt(part.thickness))];
    notes = [...holeNotes([front], noter(placed, dims)), ...toolNote(part.minInnerRadius)];
    stock = `${fmt(part.thickness)} mm plate`;
  } else if (part.kind === "square-tube") {
    placed = at(arrange(part.long, part.end, false, { main: (i) => `long${i}`, beside: "end" }));
    const end = placed[placed.length - 1];
    const [x, y] = part.size;
    dims = [across("dim:length", placed[0], fmt(part.length)), across("dim:width", end, fmt(x), true), down("dim:height", end, fmt(y))];
    if (part.wall) {
      const b = box(end);
      dims.push({ id: "dim:wall", a: [b.x0, b.y0], b: [b.x0 + part.wall * end.s, b.y0], at: b.y0 - 8, dir: "h", text: fmt(part.wall), view: end.key });
    }
    notes = [...holeNotes(placed, noter(placed, dims), end), ...toolNote(part.minInnerRadius)];
    stock = `${fmt(x)}×${fmt(y)}${part.wall ? `×${fmt(part.wall)}` : ""} tube, ${fmt(part.length)} long`;
  } else if (part.kind === "hex-shaft") {
    placed = at(arrange([part.side], part.end, false, { main: () => "side", beside: "end" }));
    const [side, end] = placed;
    dims = [across("dim:length", side, fmt(part.length)), down("dim:flats", end, fmt(part.acrossFlats))];
    const bore = end.view.holes[0];
    if (bore) {
      const tap = TAPS.find((t) => near(bore.d, t.drillMm));
      const text = tap ? tap.note : `Ø${fmt(bore.d)}`;
      notes = [{ id: `bore:${bore.faceId}`, kind: "bore", text, view: end.key, ...noter(placed, dims)(end, bore, text) }];
    }
    stock = `${fmt(part.acrossFlats)} hex, ${fmt(part.length)} long`;
  } else {
    placed = at(arrange([part.side], part.end, false, { main: () => "side", beside: "end" }));
    const [side, end] = placed;
    const b = box(end);
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    dims = [across("dim:length", side, fmt(part.length)), across("dim:od", end, `Ø${fmt(part.od)}`, true)];
    if (part.id) {
      const r = (part.id / 2) * end.s;
      dims.push({ id: "dim:id", a: [cx - r, cy], b: [cx + r, cy], at: b.y0 - 8, dir: "h", text: `Ø${fmt(part.id)}`, view: end.key });
      notes = [{ id: "wall", kind: "size", text: `Wall ${fmt((part.od - part.id) / 2)}`, at: [b.x0, b.y1 + 18], view: end.key }];
    }
    stock = `Ø${fmt(part.od)}${part.id ? `×${fmt((part.od - part.id) / 2)}` : ""} tube, ${fmt(part.length)} long`;
  }

  // Added views: where they were put, else in the middle at the main view's scale.
  placed = [
    ...placed,
    ...at(
      extras.map((x) => ({
        key: x.key,
        view: x.view,
        s: placed[0].s,
        x: (AREA.x0 + AREA.x1) / 2 - (x.view.w * placed[0].s) / 2,
        y: (AREA.y0 + AREA.y1) / 2 - (x.view.h * placed[0].s) / 2,
        ...(x.href ? { href: x.href } : {}),
      })),
    ),
  ];

  return {
    kind: part.kind,
    sheet: SHEET,
    lines: placed.flatMap(viewLines),
    views: placed.map((p): PlacedView => ({ key: p.key, x: p.x, y: p.y, s: p.s, w: p.view.w, h: p.view.h, ...(p.r ? { r: p.r } : {}), ...(p.href ? { href: p.href } : {}) })),
    holes: placed.flatMap((p) => p.view.holes.map((h) => ({ id: h.faceId, view: p.key, at: toSheet(p, h.at), r: (h.d / 2) * p.s, d: h.d }))),
    ...snapsOf(placed),
    dims,
    notes,
    title,
    stock,
    ...(image ? { image: { href: image, x: MARGIN + 4, y: MARGIN + 4, w: 50, h: 38 } } : {}),
  };
}

// What the editor's Dimension tool snaps to: each view's line ends and corners, its box corners,
// its hole centres, and its straight edges (a click on one dimensions its length).
function snapsOf(placed: Placed[]): Pick<Drawing, "snaps" | "edges"> {
  const snaps: Drawing["snaps"] = [];
  const edges: Drawing["edges"] = [];
  const seen = new Set<string>();
  const add = (at: Pt, view: string, kind: "vertex" | "center") => {
    const k = `${view}:${at[0].toFixed(2)},${at[1].toFixed(2)}`;
    if (seen.has(k)) return;
    seen.add(k);
    snaps.push({ at, view, kind });
  };
  for (const p of placed) {
    for (const l of p.view.lines) {
      const pts = l.map((q) => toSheet(p, q));
      add(pts[0], p.key, "vertex");
      add(pts[pts.length - 1], p.key, "vertex");
      // A box outline (5 points) or a polyline's straight runs: every segment of 2+ mm.
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 2) continue;
        if (l.length <= 5) add(b, p.key, "vertex");
        if (l.length === 2 || l.length === 5) edges.push({ a, b, view: p.key });
      }
    }
    for (const h of p.view.holes) add(toSheet(p, h.at), p.key, "center");
  }
  return { snaps, edges };
}

// A view-relative point on the sheet, or null when its view is gone (the part was read as
// another kind, or a tube lost a drilled face). On a hole's edge when the hole is still there.
// Points on a turned drawing (Drawing.turned) are turned with their view; `ang` is kept unturned.
export function refToSheet(d: Pick<Drawing, "views" | "holes" | "turned">, ref: Ref): Pt | null {
  const v = d.views.find((x) => x.key === ref.v);
  const xf = v && d.turned ? viewXf(v) : null;
  if (ref.hole && ref.ang != null) {
    const h = d.holes.find((x) => x.id === ref.hole);
    const ang = ref.ang + (xf ? xf.rad : 0);
    if (h) return [h.at[0] + Math.cos(ang) * h.r, h.at[1] + Math.sin(ang) * h.r];
  }
  if (!v) return null;
  const p: Pt = [v.x + ref.p[0] * v.s, v.y + (v.h - ref.p[1]) * v.s];
  return xf ? xf.fwd(p) : p;
}

// A view's turn about its centre: fwd takes an unturned sheet point to where it's drawn, inv
// back; vec / unvec turn a direction.
export type ViewXf = { c: Pt; deg: number; rad: number; turned: boolean; fwd: (p: Pt) => Pt; inv: (p: Pt) => Pt; vec: (p: Pt) => Pt; unvec: (p: Pt) => Pt };
export function viewXf(v: PlacedView): ViewXf {
  const c: Pt = [v.x + (v.w * v.s) / 2, v.y + (v.h * v.s) / 2];
  const deg = v.r ?? 0;
  const rad = (deg * Math.PI) / 180;
  const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
  const vec = (p: Pt): Pt => [p[0] * cos - p[1] * sin, p[0] * sin + p[1] * cos];
  const unvec = (p: Pt): Pt => [p[0] * cos + p[1] * sin, -p[0] * sin + p[1] * cos];
  const fwd = (p: Pt): Pt => plus(c, vec(minus2(p, c)));
  const inv = (p: Pt): Pt => plus(c, unvec(minus2(p, c)));
  return { c, deg, rad, turned: Math.abs(deg % 360) > 1e-9, fwd, inv, vec, unvec };
}
// The view's four corners as drawn (top left, top right, bottom right, bottom left).
export function viewCorners(v: PlacedView): Pt[] {
  const xf = viewXf(v);
  const [x1, y1] = [v.x + v.w * v.s, v.y + v.h * v.s];
  return ([[v.x, v.y], [x1, v.y], [x1, y1], [v.x, y1]] as Pt[]).map(xf.fwd);
}

// A dimension turned with its view: a horizontal or vertical one becomes aligned, measuring
// along its turned direction, its line and text the same distance from the part as before.
export function turnDim(d: Dim, xf: ViewXf): Dim {
  if (!xf.turned) return d;
  const f = dimFrame(d);
  const u = minus2(f.P(1, 0), f.P(0, 0));
  const line = xf.fwd(f.P(f.pa, f.at));
  const text = xf.fwd(f.P(f.tc, f.at));
  const out: Dim = { ...d, dir: "a", a: xf.fwd(d.a), b: xf.fwd(d.b), u: xf.vec(u), at: 0 };
  delete out.tx;
  out.at = dimFrame(out).local(line)[1];
  const g = dimFrame(out);
  const tx = g.local(text)[0] - g.home;
  return Math.abs(tx) > 1e-6 ? { ...out, tx } : out;
}
// A note turned with its view: its arrow tip turns, its text stays level and moves with it.
export function turnNote(n: Note, xf: ViewXf): Note {
  if (!xf.turned) return n;
  const { rect } = noteBox(n.text, n.at);
  const c: Pt = [(rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2];
  return { ...n, at: plus(n.at, minus2(xf.fwd(c), c)), ...(n.leader ? { leader: xf.fwd(n.leader) } : {}) };
}

// Each view's lines, holes, snaps, notes and dimensions turned with it, for drawing (the edits
// are applied before, on the unturned views). Lines are matched to views by where they lie.
export function turnViews(d: Drawing): Drawing {
  if (d.turned) return d;
  const xfs = new Map(d.views.filter((v) => v.r && Math.abs(v.r % 360) > 1e-9).map((v) => [v.key, viewXf(v)]));
  if (!xfs.size) return { ...d, turned: true };
  const of = (key?: string) => (key ? xfs.get(key) : undefined);
  return {
    ...d,
    turned: true,
    lines: d.lines.map((l) => {
      const xf = of(l.view);
      return xf ? { ...l, pts: l.pts.map(xf.fwd) } : l;
    }),
    holes: d.holes.map((h) => (of(h.view) ? { ...h, at: of(h.view)!.fwd(h.at) } : h)),
    snaps: d.snaps.map((s) => (of(s.view) ? { ...s, at: of(s.view)!.fwd(s.at) } : s)),
    edges: d.edges.map((e) => (of(e.view) ? { ...e, a: of(e.view)!.fwd(e.a), b: of(e.view)!.fwd(e.b) } : e)),
    dims: d.dims.map((x) => (of(x.view) ? turnDim(x, of(x.view)!) : x)),
    notes: d.notes.map((n) => (of(n.view) ? turnNote(n, of(n.view)!) : n)),
  };
}
const minus2 = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];

// The view a sheet point is on (or within 15 mm of, for notes placed beside a view), as a Ref.
// `view` pins it to one view (a dimension's second point).
export function sheetToRef(d: Pick<Drawing, "views" | "holes" | "turned">, at: Pt, opts: { view?: string; hole?: string } = {}): Ref | null {
  // On a turned drawing, the point as it would sit on each view unturned.
  const flat = (v: PlacedView) => (d.turned ? viewXf(v).inv(at) : at);
  const dist = (v: PlacedView) => {
    const p = flat(v);
    const dx = Math.max(v.x - p[0], 0, p[0] - (v.x + v.w * v.s));
    const dy = Math.max(v.y - p[1], 0, p[1] - (v.y + v.h * v.s));
    return Math.hypot(dx, dy);
  };
  const v = opts.view ? d.views.find((x) => x.key === opts.view) : [...d.views].sort((a, b) => dist(a) - dist(b))[0];
  if (!v || (!opts.view && dist(v) > 15)) return null;
  const p = flat(v);
  const ref: Ref = { v: v.key, p: [(p[0] - v.x) / v.s, v.h - (p[1] - v.y) / v.s] };
  const h = opts.hole ? d.holes.find((x) => x.id === opts.hole) : undefined;
  const turn = d.turned ? viewXf(v).rad : 0;
  return h ? { ...ref, hole: h.id, ang: Math.atan2(at[1] - h.at[1], at[0] - h.at[0]) - turn } : ref;
}

// A dimension's length in the part's millimetres: the run between two points of one view along
// its direction (straight between them when aligned), at that view's scale.
export function measure(d: Pick<Drawing, "views">, view: string, a: Pt, b: Pt, dir: DimDir): number {
  const v = d.views.find((x) => x.key === view);
  const run = dir === "h" ? Math.abs(b[0] - a[0]) : dir === "v" ? Math.abs(b[1] - a[1]) : Math.hypot(b[0] - a[0], b[1] - a[1]);
  return v ? run / v.s : run;
}

// A placed dimension's line: `off` sheet mm beyond the point furthest that way (above, below,
// left or right), so it keeps clear of the part when the drawing is laid out again.
export function dimAt(a: Pt, b: Pt, dir: "h" | "v", off: number): number {
  const [pa, pb] = dir === "h" ? [a[1], b[1]] : [a[0], b[0]];
  return off < 0 ? Math.min(pa, pb) + off : Math.max(pa, pb) + off;
}
export function dimOff(a: Pt, b: Pt, dir: "h" | "v", at: number): number {
  const [pa, pb] = dir === "h" ? [a[1], b[1]] : [a[0], b[0]];
  return at < Math.min(pa, pb) ? at - Math.min(pa, pb) : at - Math.max(pa, pb);
}

const plus = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];

// The member's edits on top of the automatic notes and dimensions: hidden, retyped or moved ones
// (a note's text and arrow apart), and the notes and dimensions they added. Positions are kept
// against the part (Ref) or as a shift from where the drawing put them, so they stay put when the
// drawing is made again at another scale; older saves' sheet positions still work.
// On the unturned drawing: a shift or an added note's `off` is in its view's own unturned frame,
// so it turns with the view (turnViews, after).
export function applyEdits(d: Drawing, e: DrawingEdits): Drawing {
  const hidden = new Set(e.hidden ?? []);
  const notes: Note[] = d.notes
    .filter((n) => !hidden.has(n.id))
    .map((n) => {
      const tip = e.tips?.[n.id] ? refToSheet(d, e.tips[n.id]) : null;
      const shift = e.shift?.[n.id];
      return {
        ...n,
        ...(e.text?.[n.id] != null ? { text: e.text[n.id] } : {}),
        ...(shift ? { at: plus(n.at, shift) } : e.moved?.[n.id] ? { at: e.moved[n.id] } : {}),
        ...(tip ? { leader: tip } : e.arrows?.[n.id] ? { leader: e.arrows[n.id] } : {}),
      };
    });
  for (const a of e.added ?? []) {
    if (hidden.has(a.id)) continue;
    const link = a.fitTargetName && (a.fitPartId || a.fitInventoryItemId) ? { name: a.fitTargetName, ...(a.fitPartId ? { partId: a.fitPartId } : { itemId: a.fitInventoryItemId }) } : undefined;
    const tip = a.ref ? refToSheet(d, a.ref) : null;
    const leader = tip ?? a.leader;
    const at = tip && a.off ? plus(tip, a.off) : a.at;
    const hole = a.dia && a.ref?.hole ? d.holes.find((h) => h.id === a.ref!.hole) : undefined;
    const text = a.dia && !a.text.trim() ? (hole ? `Ø${fmt(hole.d)}` : "Ø") : a.text;
    notes.push({ id: a.id, kind: a.dia ? "dia" : "custom", text, at, added: true, ...(leader ? { leader } : {}), ...(link ? { link } : {}), ...(tip && a.ref ? { view: a.ref.v } : {}) });
  }
  const dims: Dim[] = d.dims
    .filter((x) => !hidden.has(x.id))
    .map((x) => {
      // A shift is sheet mm: across the line moves the line, along it slides the text.
      const shift = e.shift?.[x.id];
      const [across, along] = shift ? (x.dir === "h" ? [shift[1], shift[0]] : [shift[0], shift[1]]) : [0, 0];
      return { ...x, ...(e.text?.[x.id] != null ? { text: e.text[x.id] } : {}), ...(shift ? { at: x.at + across, ...(along ? { tx: along } : {}) } : {}) };
    });
  for (const m of e.dims ?? []) {
    if (hidden.has(m.id)) continue;
    const [a, b] = [refToSheet(d, m.a), refToSheet(d, m.b)];
    if (!a || !b) continue;
    const text = m.text?.trim() ? m.text : fmt(measure(d, m.a.v, a, b, m.dir));
    const at = m.dir === "a" ? m.off : dimAt(a, b, m.dir, m.off);
    dims.push({ id: m.id, a, b, dir: m.dir, at, text, added: true, view: m.a.v, ...(m.tx ? { tx: m.tx } : {}) });
  }
  return { ...d, notes, dims };
}

// Fit notes the drawing made itself (bearings) name what they fit; one whose line matches a part
// or inventory item by name links to it, like a note added with the Fit picker.
export function linkNotes(d: Drawing, targets: { name: string; partId?: string; itemId?: string }[]): Drawing {
  if (!targets.length) return d;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byName = new Map<string, (typeof targets)[number]>();
  for (const t of targets) if (!byName.has(norm(t.name))) byName.set(norm(t.name), t);
  const notes = d.notes.map((nt) => {
    if (nt.link || nt.kind === "tool") return nt;
    const line = nt.text.split("\n").find((l) => byName.has(norm(l)));
    const t = line ? byName.get(norm(line))! : undefined;
    return t ? { ...nt, link: { name: line!.trim(), ...(t.partId ? { partId: t.partId } : { itemId: t.itemId }) } } : nt;
  });
  return { ...d, notes };
}
