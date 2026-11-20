import { WORKSHOP_ROOMS } from "./workshopMap";
import { bounds, centroid, type MapPoint } from "@/lib/inventory/places";

// The team's three PC stations (Harel, 2026-11-20): fixed items in Computers & Devices
// (inventory_items.station, added by migration 0100), each tied to its room on the floor plan.
// Their stock is their PCs, each an icon on that room; they can't be deleted or renamed.
export const STATIONS = [
  { key: "scouting", name: "Scouting PC", room: "pc-room" },
  { key: "cad", name: "CAD PC", room: "cage" },
  { key: "build", name: "Build PC", room: "circus" },
] as const;
export type StationKey = (typeof STATIONS)[number]["key"];

export const stationOf = (key: string | null | undefined) => STATIONS.find((s) => s.key === key);

// The station's room outline in floor-plan units (config/workshopMap.ts, 1000 × 560).
export function stationRoom(key: string | null | undefined): { points: MapPoint[]; centre: MapPoint; box: ReturnType<typeof bounds> } | null {
  const room = WORKSHOP_ROOMS.find((r) => r.id === stationOf(key)?.room);
  if (!room) return null;
  const points = room.points.trim().split(/\s+/).map((p) => p.split(",").map(Number) as MapPoint);
  return { points, centre: centroid(points), box: bounds(points) };
}
