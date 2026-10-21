// Plate drawings (plan/auto-drawings.md): a front view with centre marks on every hole, a side
// view with the thickness, tap and bearing fit notes, the biggest tool that fits the inner
// corners, and the BOM block. No hole positions or diameters: the shop cuts from the CAD file.

import { BEARINGS, DEFAULT_FIT, HOLE_MATCH_MM, TAPS } from "@/config/drawings";
import { type Body, type V3, cross, dot, parallel, sub, unit } from "./brep";
import type { Dim, Drawing, Line, Note, Pt, TitleBlock } from "./types";

export type Hole = { faceId: string; at: [number, number]; d: number }; // in the plate's own u/v, mm
export type Plate = {
  thickness: number;
  size: [number, number]; // along u, along v
  holes: Hole[];
  minInnerRadius?: number;
  outline: [number, number][][]; // the top face's edges in u/v
};

const SHEET = { w: 297, h: 210 }; // A4 landscape
const MARGIN = 10;
const TITLE = { w: 120, h: 36 };
const SCALES = [2, 1, 0.5, 0.2, 0.1];

export const fmt = (n: number) => String(Math.round(n * 100) / 100);

// The plate's frame: n is the normal of its biggest flat face, u the direction of its longest
// straight edge across that face, so the drawing sits square on the sheet.
export function readPlate(body: Body): Plate | null {
  const planes = body.faces.filter((f) => f.type === "PLANE" && f.dir);
  const big = planes.reduce((a, b) => (b.area > a.area ? b : a), planes[0]);
  if (!big) return null;
  const n = unit(big.dir!);
  const levels = planes.filter((f) => parallel(f.dir!, n) && f.area > big.area * 0.5).map((f) => dot(f.center, n));
  const thickness = Math.max(...levels) - Math.min(...levels);
  if (!(thickness > 0)) return null;

  let u: V3 | undefined;
  let longest = 0;
  for (const e of body.edges) {
    if (e.length !== 2) continue;
    const d = sub(e[1], e[0]);
    const len = Math.hypot(...d);
    if (len > longest && Math.abs(dot(unit(d), n)) < 1e-3) [u, longest] = [unit(d), len];
  }
  u ??= unit(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  let v = cross(n, u);

  const all = body.edges.flat();
  const extent = (a: V3) => {
    const ds = all.map((p) => dot(p, a));
    return [Math.min(...ds), Math.max(...ds)];
  };
  // Long side across the sheet.
  if (extent(v)[1] - extent(v)[0] > extent(u)[1] - extent(u)[0]) [u, v] = [v, cross(n, v)];
  const [u0, u1] = extent(u);
  const [v0, v1] = extent(v);
  const [, wTop] = extent(n);
  if (thickness > 0.25 * Math.min(u1 - u0, v1 - v0)) return null; // not flat enough to be a plate

  const uv = (p: V3): [number, number] => [dot(p, u!) - u0, dot(p, v) - v0];
  const outline = body.edges
    .filter((e) => e.every((p) => Math.abs(dot(p, n) - wTop) < 0.01))
    .map((e) => e.map(uv));
  const across = body.faces.filter((f) => f.type === "CYLINDER" && f.concave && f.dir && f.radius && parallel(f.dir, n));
  const holes = across.filter((f) => f.loops >= 2).map((f) => ({ faceId: f.id, at: uv(f.center), d: 2 * f.radius! }));
  const corners = across.filter((f) => f.loops < 2).map((f) => f.radius!);
  return {
    thickness,
    size: [u1 - u0, v1 - v0],
    holes,
    ...(corners.length ? { minInnerRadius: Math.min(...corners) } : {}),
    outline,
  };
}

const near = (a: number, b: number) => Math.abs(a - b) <= HOLE_MATCH_MM;

export function plateDrawing(plate: Plate, title: TitleBlock, image?: string): Drawing {
  const [W, H] = plate.size;
  const t = plate.thickness;
  const viewsTop = MARGIN + 20;
  const viewsBottom = SHEET.h - MARGIN - TITLE.h - 12;
  const scale =
    SCALES.find((s) => W * s + t * s + 90 <= SHEET.w - 2 * MARGIN && H * s <= viewsBottom - viewsTop) ?? SCALES[SCALES.length - 1];

  // Front view right of centre, side view to its left (ISO first angle: the view from the right).
  const fx = SHEET.w - MARGIN - 25 - W * scale;
  const fy = viewsTop + (viewsBottom - viewsTop - H * scale) / 2;
  const sheet = ([pu, pv]: [number, number]): Pt => [fx + pu * scale, fy + (H - pv) * scale];

  const lines: Line[] = plate.outline.map((e) => ({ pts: e.map(sheet), stroke: "visible" }));
  for (const h of plate.holes) {
    const [cx, cy] = sheet(h.at);
    const r = (h.d / 2) * scale + 2;
    const stroke = r < 6 ? "thin" : "center"; // a chain line too short to show its dash is drawn plain
    lines.push({ pts: [[cx - r, cy], [cx + r, cy]], stroke }, { pts: [[cx, cy - r], [cx, cy + r]], stroke });
  }

  const sx = fx - 30 - t * scale;
  lines.push({
    pts: [[sx, fy], [sx + t * scale, fy], [sx + t * scale, fy + H * scale], [sx, fy + H * scale], [sx, fy]],
    stroke: "visible",
  });
  const dims: Dim[] = [{ a: [sx, fy], b: [sx + t * scale, fy], y: fy - 8, text: fmt(t) }];

  // Notes sit above or below the view, nearest the hole, stacked when they would overlap; the
  // leader runs from the note to the hole's edge.
  const placed: { above: boolean; x0: number; x1: number; y: number }[] = [];
  const leader = (h: Hole, text: string): { leader: Pt; at: Pt } => {
    const c = sheet(h.at);
    const r = (h.d / 2) * scale;
    const above = c[1] < fy + (H * scale) / 2;
    const rows = text.split("\n");
    const width = Math.max(...rows.map((l) => l.length)) * 1.9;
    const x0 = Math.min(Math.max(c[0] - width / 2, MARGIN + 4), SHEET.w - MARGIN - 4 - width);
    const height = rows.length * 3.5 * 1.3;
    let y = above ? fy - 8 - height + 3.5 : fy + H * scale + 10;
    for (const p of placed)
      if (p.above === above && x0 < p.x1 + 3 && x0 + width > p.x0 - 3) y = above ? Math.min(y, p.y - height - 3) : Math.max(y, p.y + height + 3);
    placed.push({ above, x0, x1: x0 + width, y });
    const toward: Pt = [x0 + width / 2, above ? y + height - 3.5 : y - 3.5];
    const [dx, dy] = [toward[0] - c[0], toward[1] - c[1]];
    const l = Math.hypot(dx, dy) || 1;
    return { leader: [c[0] + (dx / l) * r, c[1] + (dy / l) * r], at: [x0, y] };
  };

  const notes: Note[] = [];
  for (const tap of TAPS) {
    const holes = plate.holes.filter((h) => near(h.d, tap.drillMm));
    if (!holes.length) continue;
    const text = `${holes.length > 1 ? `${holes.length}× ` : ""}${tap.note}`;
    notes.push({ id: `tap:${tap.drillMm}`, kind: "tap", text, ...leader(holes[0], text) });
  }
  for (const h of plate.holes) {
    const bearing = BEARINGS.find((b) => near(h.d, b.boreMm));
    if (!bearing) continue;
    const text = `${DEFAULT_FIT} fit for\n${bearing.name}\nØ${fmt(h.d)}`;
    notes.push({ id: `fit:${h.faceId}`, kind: "fit", text, ...leader(h, text) });
  }
  if (plate.minInnerRadius) {
    const r = plate.minInnerRadius;
    notes.push({ id: "tool", kind: "tool", text: `Max tool Ø${fmt(2 * r)} (inner corners R${fmt(r)})`, at: [MARGIN + 4, SHEET.h - MARGIN - 6] });
  }

  return {
    kind: "plate",
    sheet: SHEET,
    scale,
    lines,
    dims,
    notes,
    title,
    stock: `${fmt(t)} mm plate`,
    ...(image ? { image: { href: image, x: MARGIN + 4, y: MARGIN + 4, w: 60, h: 45 } } : {}),
  };
}

export const TITLE_BLOCK = TITLE;
