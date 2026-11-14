import type { MapPoint, SpotKind } from "@/db/schema";

// The shop map's places (Harel, 2026-11-14): zones on the floor plan and the drawers / shelves
// pinned on a zone's first-person picture, both rows of inventory_locations. Plain helpers the
// map, the pickers, filters and the server share.

export type { MapPoint, SpotKind };

export type Place = {
  id: string;
  name: string;
  parentId?: string | null;
  outline?: MapPoint[] | null;
  color?: string | null;
  imageUrl?: string | null;
  imageW?: number | null;
  imageH?: number | null;
  facing?: number | null;
  spotX?: number | null;
  spotY?: number | null;
  kind?: SpotKind | null;
  position?: number | null;
};

export const SPOT_KINDS: { id: SpotKind; label: string }[] = [
  { id: "drawer", label: "Drawer" },
  { id: "shelf", label: "Shelf" },
  { id: "bin", label: "Bin" },
];

// Bright, apart from each other on the dark map and on white.
export const ZONE_COLORS = ["#38BDF8", "#F472B6", "#A3E635", "#FBBF24", "#A78BFA", "#34D399", "#FB7185", "#60A5FA", "#F97316", "#2DD4BF", "#E879F9", "#FACC15"];

export const isZone = (p: Place) => !p.parentId;
export const zoneColor = (zone: Place | undefined, i = 0) => zone?.color || ZONE_COLORS[i % ZONE_COLORS.length];

export function placeIndex(places: Place[]) {
  return new Map(places.map((p) => [p.id, p]));
}

// The zone a place is in (itself for a zone); undefined for an unknown id.
export function zoneOf<T extends Place>(id: string | null | undefined, byId: Map<string, T>): T | undefined {
  const p = id ? byId.get(id) : undefined;
  if (!p) return undefined;
  return p.parentId ? (byId.get(p.parentId) ?? p) : p;
}

// Filtering by a zone keeps its drawers' items too; by a drawer, only that drawer's.
export function inPlace(itemPlace: string | null | undefined, filter: string, byId: Map<string, Place>) {
  if (!itemPlace) return false;
  if (itemPlace === filter) return true;
  return byId.get(itemPlace)?.parentId === filter;
}

export const spotsOf = <T extends Place>(zoneId: string, places: T[]) =>
  places.filter((p) => p.parentId === zoneId).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name));

export const kindLabel = (k: SpotKind | null | undefined) => SPOT_KINDS.find((s) => s.id === k)?.label ?? "Spot";

// What a picker button says when names are hidden: the place's kind, never its name.
export function placeWord(p: Place | undefined) {
  if (!p) return "No place";
  return p.parentId ? kindLabel(p.kind) : "Zone";
}

export function bounds(points: MapPoint[]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// The polygon's centre of area (its bounding-box centre when it's degenerate).
export function centroid(points: MapPoint[]): MapPoint {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const f = xj * yi - xi * yj;
    a += f;
    cx += (xi + xj) * f;
    cy += (yi + yj) * f;
  }
  if (Math.abs(a) < 1e-6) {
    const b = bounds(points);
    return [b.cx, b.cy];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInPolygon(x: number, y: number, pts: MapPoint[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// A new spot's hidden name: "<zone> · Drawer 3", the first number not taken.
export function nextSpotName(zone: Place, kind: SpotKind, places: Place[]) {
  const taken = new Set(places.map((p) => p.name.toLowerCase()));
  const base = `${zone.name} · ${kindLabel(kind)}`;
  for (let n = 1; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

export function nextZoneName(places: Place[]) {
  const taken = new Set(places.map((p) => p.name.toLowerCase()));
  for (let n = 1; ; n++) if (!taken.has(`zone ${n}`)) return `Zone ${n}`;
}
