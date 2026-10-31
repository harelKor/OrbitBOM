// A drawing as one SVG in sheet millimetres, ISO style: thick visible lines, thin dimension and
// leader lines, thin chain centre lines, 3.5 mm lettering, BOM block bottom right.

import { INK } from "@/config/drawings";
import { MARGIN, noteBox, TITLE } from "./layout";
import type { Dim, Drawing, Note, Pt, Stroke } from "./types";

const STROKES: Record<Stroke, string> = {
  visible: `stroke="${INK.part}" stroke-width="0.5"`,
  thin: `stroke="${INK.center}" stroke-width="0.25"`,
  center: `stroke="${INK.center}" stroke-width="0.25" stroke-dasharray="6 1.5 1 1.5"`,
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (x: number) => String(Math.round(x * 100) / 100);
const path = (pts: Pt[]) => pts.map((p, i) => `${i ? "L" : "M"}${n(p[0])} ${n(p[1])}`).join("");
// A dimension, extension or leader line: heavier and darker than the part's lines (INK).
const thin = (pts: Pt[]) => `<path d="${path(pts)}" fill="none" stroke="${INK.annotation}" stroke-width="${INK.annotationWidth}" stroke-linecap="round"/>`;

// A filled arrowhead with its tip at `tip`, pointing away from `from`: long and wide enough to
// read at a glance on a printed sheet.
function arrow(tip: Pt, from: Pt) {
  const [dx, dy] = [tip[0] - from[0], tip[1] - from[1]];
  const l = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / l, dy / l];
  const [len, half] = [INK.arrowLength, INK.arrowHalfWidth];
  const [bx, by] = [tip[0] - ux * len, tip[1] - uy * len];
  return `<path d="M${n(tip[0])} ${n(tip[1])}L${n(bx - uy * half)} ${n(by + ux * half)}L${n(bx + uy * half)} ${n(by - ux * half)}Z" fill="${INK.annotation}" stroke="${INK.annotation}" stroke-width="0.15" stroke-linejoin="round"/>`;
}

function text(at: Pt, value: string, opts: { size?: number; anchor?: string; bold?: boolean; rotate?: boolean } = {}) {
  const size = opts.size ?? 3.5;
  const attrs = [
    `font-size="${size}"`,
    opts.anchor ? `text-anchor="${opts.anchor}"` : "",
    opts.bold ? 'font-weight="bold"' : "",
    opts.rotate ? `transform="rotate(-90 ${n(at[0])} ${n(at[1])})"` : "",
  ].join(" ");
  return `<text x="${n(at[0])}" y="${n(at[1])}" ${attrs}>${value
    .split("\n")
    .map((l, i) => `<tspan x="${n(at[0])}" dy="${i ? size * 1.3 : 0}">${esc(l)}</tspan>`)
    .join("")}</text>`;
}

// Extension lines, the dimension line, and arrows outside when the gap is too small for them.
// Worked out along the dimension, then mapped back for vertical ones.
function dimension(dim: Dim): string {
  const v = dim.dir === "v";
  const P = (along: number, off: number): Pt => (v ? [off, along] : [along, off]);
  const [a, b] = v ? [dim.a[1], dim.b[1]] : [dim.a[0], dim.b[0]];
  const [ea, eb] = v ? [dim.a[0], dim.b[0]] : [dim.a[1], dim.b[1]];
  const side = Math.sign(dim.at - ea) || -1;
  const out = [thin([P(a, ea + side), P(a, dim.at + side * 2)]), thin([P(b, eb + side), P(b, dim.at + side * 2)])];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  if (hi - lo < 10) {
    out.push(thin([P(lo - 10, dim.at), P(hi + 10, dim.at)]), arrow(P(lo, dim.at), P(lo - 5, dim.at)), arrow(P(hi, dim.at), P(hi + 5, dim.at)));
    out.push(v ? text(P(lo - 12, dim.at - 1), dim.text, { rotate: true, anchor: "end" }) : text(P(hi + 12, dim.at + 1.2), dim.text));
  } else {
    out.push(thin([P(lo, dim.at), P(hi, dim.at)]), arrow(P(lo, dim.at), P(hi, dim.at)), arrow(P(hi, dim.at), P(lo, dim.at)));
    out.push(text(P((lo + hi) / 2, dim.at - 1), dim.text, { anchor: "middle", rotate: v }));
  }
  return out.join("");
}

function note(nt: Note): string {
  if (!nt.leader) return text(nt.at, nt.text, nt.kind === "tool" ? { size: 5, bold: true } : {});
  // The leader leaves from the text's lower edge (above the view) or upper edge (below it).
  const { end } = noteBox(nt.text, nt.at, nt.leader);
  return thin([end!, nt.leader]) + arrow(nt.leader, end!) + text(nt.at, nt.text);
}

export function drawingSvg(d: Drawing): string {
  const { w, h } = d.sheet;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" font-family="Arial, Helvetica, sans-serif">`,
    `<rect width="${w}" height="${h}" fill="#fff"/>`,
    `<rect x="${MARGIN}" y="${MARGIN}" width="${w - 2 * MARGIN}" height="${h - 2 * MARGIN}" fill="none" stroke="#000" stroke-width="0.7"/>`,
  ];
  if (d.image) out.push(`<image href="${esc(d.image.href)}" x="${d.image.x}" y="${d.image.y}" width="${d.image.w}" height="${d.image.h}" preserveAspectRatio="xMidYMid meet"/>`);
  out.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round">');
  for (const l of d.lines) out.push(`<path d="${path(l.pts)}" ${STROKES[l.stroke]}/>`);
  out.push("</g>", ...d.dims.map(dimension), ...d.notes.map(note), titleBlock(d), "</svg>");
  return out.join("");
}

function titleBlock(d: Drawing) {
  const { w: tw, h: th } = TITLE;
  const x = d.sheet.w - MARGIN - tw;
  const y = d.sheet.h - MARGIN - th;
  const t = d.title;
  const rows: [string, string][][] = [
    [["Material", t.material ?? ""], ["Qty", t.quantity != null ? String(t.quantity) : ""]],
    [["Stock", d.stock], ["Ver", t.revision ?? ""]],
    [["Process", (t.processes ?? []).join(" → ")], ["Date", t.date ?? ""]],
    [["System", [t.robot, t.system].filter(Boolean).join(" / ")]],
  ];
  const nameH = 8;
  const rowH = (th - nameH) / rows.length;
  const split = x + tw * 0.68;
  const g: string[] = [`<g stroke="#000" fill="none"><rect x="${x}" y="${y}" width="${tw}" height="${th}" stroke-width="0.5"/>`];
  g.push(`<path d="M${x} ${y + nameH}h${tw}" stroke-width="0.25"/>`);
  for (let i = 1; i < rows.length; i++) g.push(`<path d="M${x} ${n(y + nameH + i * rowH)}h${tw}" stroke-width="0.25"/>`);
  g.push(`<path d="M${split} ${y + nameH}v${n(rowH * (rows.length - 1))}" stroke-width="0.25"/></g>`);
  g.push(`<text x="${x + 2}" y="${y + 5.8}" font-size="5" font-weight="bold">${esc(t.name)}</text>`);
  rows.forEach((row, i) => {
    const ty = y + nameH + i * rowH + rowH / 2 + 1;
    row.forEach(([label, value], j) => {
      g.push(`<text x="${n((j ? split : x) + 2)}" y="${n(ty)}" font-size="2"><tspan fill="#666">${label}</tspan><tspan dx="1.5" font-size="2.8">${esc(value)}</tspan></text>`);
    });
  });
  return g.join("");
}
