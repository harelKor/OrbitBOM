// A drawing as one SVG in sheet millimetres, ISO style: thick visible lines, thin dimension and
// leader lines, thin chain centre lines, 3.5 mm lettering, BOM block bottom right.

import { INK } from "@/config/drawings";
import { dimFrame, dimSpan, MARGIN, noteBox, TITLE } from "./layout";
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

// `nameLine`: the line given the "fit-name" class (-1: every line), lit on hover in the app.
function text(at: Pt, value: string, opts: { size?: number; anchor?: string; bold?: boolean; rotate?: boolean; nameLine?: number } = {}) {
  const size = opts.size ?? 3.5;
  const attrs = [
    `font-size="${size}"`,
    opts.anchor ? `text-anchor="${opts.anchor}"` : "",
    opts.bold ? 'font-weight="bold"' : "",
    opts.rotate ? `transform="rotate(-90 ${n(at[0])} ${n(at[1])})"` : "",
  ].join(" ");
  return `<text x="${n(at[0])}" y="${n(at[1])}" ${attrs}>${value
    .split("\n")
    .map((l, i) => `<tspan x="${n(at[0])}" dy="${i ? size * 1.3 : 0}"${opts.nameLine === i || opts.nameLine === -1 ? ' class="fit-name"' : ""}>${esc(l)}</tspan>`)
    .join("")}</text>`;
}

// Extension lines, the dimension line, and arrows outside when the gap is too small for them.
// Worked out along the dimension (layout.ts dimFrame), then mapped back onto the sheet. Text
// slid past the arrows gets the line run on under it.
export function dimension(dim: Dim): string {
  const f = dimFrame(dim);
  const { P, at } = f;
  const side = (e: number) => Math.sign(at - e) || -1;
  const out = [thin([P(f.pa, f.ea + side(f.ea)), P(f.pa, at + side(f.ea) * 2)]), thin([P(f.pb, f.eb + side(f.eb)), P(f.pb, at + side(f.eb) * 2)])];
  const [s0, s1] = dimSpan(dim);
  out.push(thin([P(s0, at), P(s1, at)]));
  if (f.short) out.push(arrow(P(f.lo, at), P(f.lo - 5, at)), arrow(P(f.hi, at), P(f.hi + 5, at)));
  else out.push(arrow(P(f.lo, at), P(f.hi, at)), arrow(P(f.hi, at), P(f.lo, at)));
  const [x, y] = P(f.tc, at - 1);
  out.push(
    `<text x="${n(x)}" y="${n(y)}" font-size="3.5" text-anchor="middle"${f.angle ? ` transform="rotate(${n(f.angle)} ${n(x)} ${n(y)})"` : ""}>${esc(dim.text)}</text>`,
  );
  return out.join("");
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// In the app, a note linked to a part or inventory item is one clickable group: its name lights
// up on hover and a click opens that part's or item's window (DrawingEditor, DrawingPreview).
export function note(nt: Note, live: boolean): string {
  const link = live ? nt.link : undefined;
  const nameLine = link ? nt.text.split("\n").findIndex((l) => norm(l) === norm(link.name)) : undefined;
  const opts = { ...(nt.kind === "tool" ? { size: 5, bold: true } : {}), ...(link ? { nameLine } : {}) };
  let body: string;
  if (!nt.leader) body = text(nt.at, nt.text, opts);
  else {
    // The leader leaves from the text's lower edge (above the view) or upper edge (below it).
    const { end } = noteBox(nt.text, nt.at, nt.leader);
    body = thin([end!, nt.leader]) + arrow(nt.leader, end!) + text(nt.at, nt.text, opts);
  }
  if (!link) return body;
  const { rect } = noteBox(nt.text, nt.at);
  const data = link.partId ? `data-fit-part="${esc(link.partId)}"` : `data-fit-item="${esc(link.itemId ?? "")}"`;
  return `<g class="fit-link" ${data} data-fit-name="${esc(link.name)}"><title>Open ${esc(link.name)}</title><rect class="fit-hit" x="${n(rect.x0 - 1)}" y="${n(rect.y0 - 1)}" width="${n(rect.x1 - rect.x0 + 2)}" height="${n(rect.y1 - rect.y0 + 2)}" rx="1" fill="transparent"/>${body}</g>`;
}

const LIVE_STYLE =
  "<style>.fit-link{cursor:pointer}.fit-link:hover .fit-name{fill:#0284c7;text-decoration:underline}.fit-link:hover .fit-hit{fill:rgba(56,189,248,.14)}</style>";

// `live`: drawn in the app, where linked notes are clickable; files (PNG, PDF) leave it off.
export function drawingSvg(d: Drawing, { live = false }: { live?: boolean } = {}): string {
  const { w, h } = d.sheet;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}" font-family="Arial, Helvetica, sans-serif">`,
    `<rect width="${w}" height="${h}" fill="#fff"/>`,
    `<rect x="${MARGIN}" y="${MARGIN}" width="${w - 2 * MARGIN}" height="${h - 2 * MARGIN}" fill="none" stroke="#000" stroke-width="0.7"/>`,
  ];
  if (live) out.push(LIVE_STYLE);
  // Added angled views: their picture, turned with the view about its centre.
  for (const v of d.views) {
    if (!v.href) continue;
    const [w, h] = [v.w * v.s, v.h * v.s];
    const turn = v.r ? ` transform="rotate(${n(v.r)} ${n(v.x + w / 2)} ${n(v.y + h / 2)})"` : "";
    out.push(`<image href="${esc(v.href)}" x="${n(v.x)}" y="${n(v.y)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="none"${turn}/>`);
  }
  if (d.image) out.push(`<image href="${esc(d.image.href)}" x="${d.image.x}" y="${d.image.y}" width="${d.image.w}" height="${d.image.h}" preserveAspectRatio="xMidYMid meet"/>`);
  out.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round">');
  for (const l of d.lines) out.push(`<path d="${path(l.pts)}" ${STROKES[l.stroke]}/>`);
  out.push("</g>", ...d.dims.map(dimension), ...d.notes.map((nt) => note(nt, live)), titleBlock(d), "</svg>");
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
