import { MAP_H, MAP_W } from "@/config/workshopMap";
import { bounds, type MapPoint, type Place } from "@/lib/inventory/places";

// The shop map's camera (Harel, 2026-11-14) as plain numbers, so zooming, the dive into a zone's
// picture and the 2-second "where is it" flight are one model:
// - plan: the floor plan's view box (x, y = top-left, w = width in map units).
// - dive: 0 on the floor plan, 1 standing in the zone looking at its picture. Zooming in past the
//   zone's fit turns into dive, zooming out of the picture turns it back.
// - scene: zoom (1 = whole picture) and centre (0..1 of the picture) inside the picture.

export type Plan = { x: number; y: number; w: number };
export type Scene = { s: number; cx: number; cy: number };
export type Cam = { plan: Plan; zone: string | null; dive: number; scene: Scene };

export const MIN_W = 70;
export const SCENE_MAX = 5;
// How much zooming (as a factor) a whole dive takes.
export const DIVE_SPAN = 2.4;
export const FIND_MS = 2000;

export const FULL_SCENE: Scene = { s: 1, cx: 0.5, cy: 0.5 };
export const fullPlan = (aspect: number): Plan => {
  // The whole floor plan in view, whatever the box's shape.
  const w = Math.max(MAP_W, MAP_H / aspect);
  return { x: (MAP_W - w) / 2, y: (MAP_H - w * aspect) / 2, w };
};
export const homeCam = (aspect: number): Cam => ({ plan: fullPlan(aspect), zone: null, dive: 0, scene: FULL_SCENE });

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const smoothstep = (a: number, b: number, v: number) => smooth(clamp((v - a) / (b - a), 0, 1));
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function clampPlan(p: Plan, aspect: number): Plan {
  const full = fullPlan(aspect);
  const w = clamp(p.w, MIN_W, full.w);
  const h = w * aspect;
  return { w, x: clamp(p.x, -w / 2, MAP_W - w / 2), y: clamp(p.y, -h / 2, MAP_H - h / 2) };
}

export const planCenter = (p: Plan, aspect: number): MapPoint => [p.x + p.w / 2, p.y + (p.w * aspect) / 2];
export const centeredPlan = (cx: number, cy: number, w: number, aspect: number): Plan => ({ x: cx - w / 2, y: cy - (w * aspect) / 2, w });

// The view that fits a zone with some room around it.
export function zoneFit(zone: Place, aspect: number): Plan | null {
  if (!zone.outline?.length) return null;
  const b = bounds(zone.outline);
  const w = Math.max(b.w * 1.5, (b.h * 1.5) / aspect, MIN_W * 1.4);
  return centeredPlan(b.cx, b.cy, w, aspect);
}

// The flight to a place, as the camera at time t (0..FIND_MS): the whole map, glide to the zone
// (0–0.7 s), dive into its picture (0.7–1.4 s), zoom to the drawer (1.4–2 s). A zone with no
// picture glides the whole time.
export function findCam(t: number, zone: Place, spot: Place | null, aspect: number): Cam {
  const start = fullPlan(aspect);
  const fit = zoneFit(zone, aspect) ?? start;
  const hasScene = !!zone.imageUrl;
  const glideEnd = hasScene ? 700 : FIND_MS * 0.8;
  const g = easeInOut(clamp(t / glideEnd, 0, 1));
  // Glide in a gentle zoom-out-zoom-in arc: the width moves on a log scale, so the zoom reads even.
  const w = Math.exp(lerp(Math.log(start.w), Math.log(fit.w), g));
  const [sx, sy] = planCenter(start, aspect);
  const [fx, fy] = planCenter(fit, aspect);
  const plan = centeredPlan(lerp(sx, fx, g), lerp(sy, fy, g), w, aspect);
  if (!hasScene) return { plan, zone: zone.id, dive: 0, scene: FULL_SCENE };
  const dive = easeInOut(clamp((t - 700) / 700, 0, 1));
  const z = easeInOut(clamp((t - 1400) / 600, 0, 1));
  const scene: Scene =
    spot && spot.spotX != null && spot.spotY != null
      ? { s: lerp(1, 2.2, z), cx: lerp(0.5, spot.spotX, z), cy: lerp(0.5, spot.spotY, z) }
      : FULL_SCENE;
  return { plan, zone: zone.id, dive, scene };
}

// Keep the picture's centre where the zoomed picture still covers the box.
export function clampScene(s: Scene): Scene {
  const z = clamp(s.s, 1, SCENE_MAX);
  const half = 0.5 / z;
  return { s: z, cx: clamp(s.cx, half, 1 - half), cy: clamp(s.cy, half, 1 - half) };
}
