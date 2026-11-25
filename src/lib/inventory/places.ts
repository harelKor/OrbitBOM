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
  // A 360° picture (null: by its shape).
  panorama?: boolean | null;
  spotX?: number | null;
  spotY?: number | null;
  spotW?: number | null;
  spotH?: number | null;
  kind?: SpotKind | null;
  // A "zone" spot's zone (it leads there).
  linkId?: string | null;
  position?: number | null;
};

export const SPOT_KINDS: { id: SpotKind; label: string }[] = [
  { id: "drawer", label: "Drawer" },
  { id: "shelf", label: "Shelf" },
  { id: "bin", label: "Bin" },
  // Only on a 360° picture: a door you tap to walk into another zone (Harel, 2026-11-20).
  { id: "zone", label: "Zone" },
];
// What a zone's picture offers: drawers, shelves and bins, and on a 360° one zone doors too.
export const spotKindsFor = (zone: Place | null | undefined) => SPOT_KINDS.filter((k) => k.id !== "zone" || isPanorama(zone));
// A door to another zone holds no items: never a place to choose for them.
export const isDoor = (p: Pick<Place, "kind"> | null | undefined) => p?.kind === "zone";
export const DOOR_HOLDS_NOTHING = "That's a door to another zone, not a place for items: pick a drawer, shelf or bin.";

// Bright, apart from each other on the dark map and on white.
export const ZONE_COLORS = ["#38BDF8", "#F472B6", "#A3E635", "#FBBF24", "#A78BFA", "#34D399", "#FB7185", "#60A5FA", "#F97316", "#2DD4BF", "#E879F9", "#FACC15"];

export const isZone = (p: Place) => !p.parentId;
// Wider than this is taken for a 360° picture unless the zone says otherwise.
export const PANORAMA_RATIO = 2.6;
export const isPanoramaPicture = (w?: number | null, h?: number | null) => !!w && !!h && w / h >= PANORAMA_RATIO;
// Whether the zone's picture is shown as a first-person 360° panorama (Harel, 2026-11-20).
export const isPanorama = (z: Place | null | undefined) => !!z?.imageUrl && (z.panorama ?? isPanoramaPicture(z.imageW, z.imageH));
// Every zone wears the one Orbit tint (Harel, 2026-11-14: no rainbow), so this is the accent in
// CSS (style props, not SVG attributes). The stored colour is kept but not shown.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- same call shape as before
export const zoneColor = (_zone?: Place, _i = 0) => "var(--color-accent)";

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

// A spot's tag on its zone's picture, all 0..1 of the picture: centre and size. A spot pinned
// before tags had sizes gets a square about a twelfth of the picture wide.
export const DEFAULT_SPOT_W = 0.08;
export const MIN_SPOT = 0.015;
export function spotRect(spot: Place, zone?: Place | null) {
  const aspect = zone?.imageW && zone.imageH ? zone.imageW / zone.imageH : 16 / 10;
  const w = spot.spotW ?? (spot.spotH != null ? spot.spotH / aspect : DEFAULT_SPOT_W);
  const h = spot.spotH ?? w * aspect;
  return { x: spot.spotX ?? 0.5, y: spot.spotY ?? 0.5, w, h };
}

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

// A 360° zone is a circle on the floor plan (Harel, 2026-11-20): you stand in its middle and look
// round. Stored as an ordinary outline of CIRCLE_POINTS corners, so everything else reads it as is.
export const CIRCLE_POINTS = 24;
export function circleOutline([cx, cy]: MapPoint, r: number): MapPoint[] {
  return Array.from({ length: CIRCLE_POINTS }, (_, i) => {
    const a = (i / CIRCLE_POINTS) * 2 * Math.PI;
    return [Math.round((cx + r * Math.cos(a)) * 10) / 10, Math.round((cy + r * Math.sin(a)) * 10) / 10] as MapPoint;
  });
}
// The circle with a shape's centre and area (a 32 × 26 zone gets r ≈ 16).
export function circleOf(points: MapPoint[]): MapPoint[] {
  // Already a circle: kept as it is (ticking again mustn't shrink it).
  if (points.length === CIRCLE_POINTS) {
    const { r } = circleOfOutline(points);
    const c = centroid(points);
    if (r > 0 && points.every(([x, y]) => Math.abs(Math.hypot(x - c[0], y - c[1]) - r) < r * 0.03 + 0.2)) return points;
  }
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  const r = Math.max(Math.sqrt(Math.abs(a / 2) / Math.PI), 4);
  return circleOutline(centroid(points), r);
}
// A circle's centre and radius (the mean distance of its corners).
export function circleOfOutline(points: MapPoint[]) {
  const c = centroid(points);
  const r = points.reduce((s, [x, y]) => s + Math.hypot(x - c[0], y - c[1]), 0) / points.length;
  return { c, r };
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

// Why a zone or spot can't be deleted yet, or null when nothing is in it.
export function placeInUseMessage(what: string, items: number, groups: number): string | null {
  const parts = [items && `${items} item${items === 1 ? "" : "s"}`, groups && `${groups} item group${groups === 1 ? "" : "s"}`].filter(Boolean);
  if (!parts.length) return null;
  const them = items + groups === 1 ? "it" : "them";
  return `${what} still holds ${parts.join(" and ")}. Move ${them} to another place first.`;
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
