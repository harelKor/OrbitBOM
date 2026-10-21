// A drawing as one SVG in sheet millimetres, ISO style: thick visible lines, thin dimension and
// leader lines, thin chain centre lines, 3.5 mm lettering, BOM block bottom right.

import { fmt, TITLE_BLOCK } from "./plate";
import type { Drawing, Pt, Stroke } from "./types";

const STROKES: Record<Stroke, string> = {
  visible: 'stroke-width="0.5"',
  thin: 'stroke-width="0.25"',
  center: 'stroke-width="0.25" stroke-dasharray="6 1.5 1 1.5"',
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (x: number) => String(Math.round(x * 100) / 100);
const path = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${n(p[0])} ${n(p[1])}`).join("");

// A filled arrowhead with its tip at `tip`, pointing away from `from`.
function arrow(tip: Pt, from: Pt) {
  const [dx, dy] = [tip[0] - from[0], tip[1] - from[1]];
  const l = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / l, dy / l];
  const [bx, by] = [tip[0] - ux * 3, tip[1] - uy * 3];
  return `<path d="M${n(tip[0])} ${n(tip[1])}L${n(bx - uy * 0.6)} ${n(by + ux * 0.6)}L${n(bx + uy * 0.6)} ${n(by - ux * 0.6)}Z" fill="#000"/>`;
}

function text(at: Pt, value: string, size = 3.5, anchor = "start") {
  const lines = value.split("\n");
  return `<text x="${n(at[0])}" y="${n(at[1])}" font-size="${size}" text-anchor="${anchor}">${lines
    .map((l, i) => `<tspan x="${n(at[0])}" dy="${i ? size * 1.3 : 0}">${esc(l)}</tspan>`)
    .join("")}</text>`;
}

export function drawingSvg(d: Drawing): string {
  const { w, h } = d.sheet;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" font-family="Arial, Helvetica, sans-serif">`,
    `<rect width="${w}" height="${h}" fill="#fff"/>`,
    `<rect x="10" y="10" width="${w - 20}" height="${h - 20}" fill="none" stroke="#000" stroke-width="0.7"/>`,
  ];
  if (d.image) out.push(`<image href="${esc(d.image.href)}" x="${d.image.x}" y="${d.image.y}" width="${d.image.w}" height="${d.image.h}" preserveAspectRatio="xMidYMid meet"/>`);

  out.push('<g fill="none" stroke="#000" stroke-linecap="round" stroke-linejoin="round">');
  for (const l of d.lines) out.push(`<path d="${path(l.pts)}" ${STROKES[l.stroke]}/>`);
  out.push("</g>");

  // Dimensions: extension lines, the dimension line, arrows outside when the gap is small.
  for (const dim of d.dims) {
    const [a, b] = [dim.a, dim.b];
    const tight = Math.abs(b[0] - a[0]) < 10;
    const g: string[] = [
      `<path d="${path([[a[0], a[1] - 1], [a[0], dim.y - 2]])}M${n(b[0])} ${n(b[1] - 1)}L${n(b[0])} ${n(dim.y - 2)}" stroke="#000" stroke-width="0.25"/>`,
    ];
    const pa: Pt = [a[0], dim.y];
    const pb: Pt = [b[0], dim.y];
    if (tight) {
      g.push(`<path d="${path([[a[0] - 10, dim.y], [b[0] + 10, dim.y]])}" stroke="#000" stroke-width="0.25"/>`);
      g.push(arrow(pa, [a[0] - 5, dim.y]), arrow(pb, [b[0] + 5, dim.y]));
      g.push(text([b[0] + 12, dim.y + 1.2], dim.text));
    } else {
      g.push(`<path d="${path([pa, pb])}" stroke="#000" stroke-width="0.25"/>`);
      g.push(arrow(pa, pb), arrow(pb, pa));
      g.push(text([(a[0] + b[0]) / 2, dim.y - 1], dim.text, 3.5, "middle"));
    }
    out.push(...g);
  }

  for (const note of d.notes) {
    if (note.leader) {
      // The leader leaves from the text's lower edge (above the view) or upper edge (below it).
      const rows = note.text.split("\n").length;
      const width = Math.max(...note.text.split("\n").map((l) => l.length)) * 1.9;
      const below = note.leader[1] < note.at[1];
      const end: Pt = [note.at[0] + width / 2, below ? note.at[1] - 3.5 : note.at[1] + (rows - 1) * 3.5 * 1.3 + 1.2];
      out.push(`<path d="${path([end, note.leader])}" fill="none" stroke="#000" stroke-width="0.25"/>`, arrow(note.leader, end));
      out.push(text(note.at, note.text));
    } else out.push(text(note.at, note.text));
  }

  out.push(titleBlock(d));
  out.push("</svg>");
  return out.join("");
}

function titleBlock(d: Drawing) {
  const { w: tw, h: th } = TITLE_BLOCK;
  const x = d.sheet.w - 10 - tw;
  const y = d.sheet.h - 10 - th;
  const t = d.title;
  const scale = d.scale >= 1 ? `${fmt(d.scale)}:1` : `1:${fmt(1 / d.scale)}`;
  const rows: [string, string][][] = [
    [["Part no.", t.partNumber ?? ""], ["Qty", t.quantity != null ? String(t.quantity) : ""]],
    [["Material", t.material ?? ""], ["Stock", d.stock]],
    [["Process", (t.processes ?? []).join(" → ")], ["Scale", scale]],
    [["System", [t.robot, t.system].filter(Boolean).join(" / ")], ["Rev", t.revision ?? ""]],
    [["Designer", t.designer ?? ""], ["Date", t.date ?? ""]],
  ];
  const g: string[] = [`<g stroke="#000" fill="none"><rect x="${x}" y="${y}" width="${tw}" height="${th}" stroke-width="0.5"/>`];
  const nameH = 8;
  const rowH = (th - nameH) / rows.length;
  g.push(`<path d="M${x} ${y + nameH}h${tw}" stroke-width="0.25"/>`);
  for (let i = 1; i < rows.length; i++) g.push(`<path d="M${x} ${n(y + nameH + i * rowH)}h${tw}" stroke-width="0.25"/>`);
  g.push(`<path d="M${x + tw * 0.68} ${y + nameH}v${th - nameH}" stroke-width="0.25"/></g>`);
  g.push(`<text x="${x + 2}" y="${y + 5.8}" font-size="5" font-weight="bold">${esc(t.name)}</text>`);
  g.push(`<text x="${x + tw - 2}" y="${y + 5.8}" font-size="2.5" text-anchor="end">ISO · first angle · mm</text>`);
  rows.forEach((row, i) => {
    const ty = y + nameH + i * rowH + rowH / 2 + 1;
    row.forEach(([label, value], j) => {
      const cx = x + (j ? tw * 0.68 : 0) + 2;
      g.push(`<text x="${n(cx)}" y="${n(ty)}" font-size="2"><tspan fill="#666">${label}</tspan><tspan dx="1.5" font-size="2.8">${esc(value)}</tspan></text>`);
    });
  });
  return g.join("");
}
