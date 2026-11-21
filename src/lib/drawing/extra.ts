// Views added with the drawing editor's Add view (Harel, 2026-11-21). A straight one (the
// camera on one of the view cube's faces, at any quarter turn) is a real measured view, made
// again from the part's kept geometry (bodyPack.ts) each time, so it follows the part like the
// drawing's own views. An angled one is a picture drawn in the browser (picture.ts) and kept in
// R2; it has no lines to dimension.

import type { DrawingEdits } from "@/db/schema";
import type { Body, V3 } from "./brep";
import { cross, unit } from "./brep";
import { straightView, type View } from "./read";

export type Extra = NonNullable<DrawingEdits["extra"]>[number];
export type ExtraView = { key: string; view: View; href?: string };

// Within 1° of an axis: that axis, else null.
export function snapAxis(v: V3): V3 | null {
  const u = unit(v);
  const i = [0, 1, 2].find((k) => Math.abs(u[k]) > Math.cos(Math.PI / 180));
  if (i === undefined) return null;
  const out: V3 = [0, 0, 0];
  out[i] = Math.sign(u[i]);
  return out;
}

// Straight when both the camera's direction and its right lie on axes.
export function isStraight(dir: V3, right: V3) {
  return !!snapAxis(dir) && !!snapAxis(right);
}

export function extraView(body: Body | null, x: Extra, href?: string | null): ExtraView | null {
  if (x.pic) return href ? { key: x.key, view: { w: x.pic.w, h: x.pic.h, lines: [], holes: [] }, href } : null;
  const [w, h] = [snapAxis(x.dir), snapAxis(x.right)];
  if (!body || !w || !h || Math.abs(cross(w, h).reduce((t, c) => t + Math.abs(c), 0) - 1) > 1e-6) return null;
  return { key: x.key, view: straightView(body, w, h) };
}

// Every added view that can be shown: a straight one needs the geometry, a picture its file.
export function extraViews(body: Body | null, extra: Extra[] | undefined, hrefs: Record<string, string | null> = {}): ExtraView[] {
  return (extra ?? []).flatMap((x) => extraView(body, x, hrefs[x.key]) ?? []);
}

// The R2 file of an angled view's picture.
export const pictureKey = (partId: string, key: string) => `drawings/${partId}/${key}.png`;
