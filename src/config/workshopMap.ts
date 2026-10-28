// The workshop floor plan behind Inventory's map (Harel, 2026-10-28), in the map's own units
// (viewBox 0 0 1000 560), traced from the labeled floor plan. Rooms are fixed; the 16 shelf pins
// are seeded into inventory_locations (map_x, map_y) by migration 0044 and can be dragged in Edit
// mode, so the database holds their live positions.

export const MAP_W = 1000;
export const MAP_H = 560;

export type WorkshopRoom = {
  id: string;
  label: string;
  subLabels?: { text: string; x: number; y: number; size: number }[];
  labelPos: [number, number];
  labelSize: number;
  points: string;
  // The main complex is drawn a shade lighter than the outbuildings.
  main?: boolean;
};

export const WORKSHOP_ROOMS: WorkshopRoom[] = [
  // Main central complex ("קרקס" and the rooms attached to it)
  {
    id: "circus",
    label: "קרקס",
    subLabels: [
      { text: "אלק׳", x: 262, y: 186, size: 11 },
      { text: "כניסה", x: 528, y: 318, size: 11 },
    ],
    labelPos: [332, 165],
    labelSize: 22,
    points:
      "207,60 258,92 376,60 421,274 463,273 497,271 552,282 563,318 561,353 497,378 483,325 402,331 286,331 253,287 253,230 200,207 231,140 179,93",
    main: true,
  },
  {
    id: "sadna",
    label: "סדנא",
    labelPos: [432, 152],
    labelSize: 13,
    points: "376,60 451,42 460,76 442,81 482,193 446,200 463,273 421,274",
    main: true,
  },
  {
    id: "cnc",
    label: "סנס",
    labelPos: [472, 236],
    labelSize: 12,
    points: "446,200 482,193 497,271 463,273",
    main: true,
  },
  {
    id: "pc-room",
    label: "חדר פיסי",
    labelPos: [352, 370],
    labelSize: 12,
    points: "286,331 402,331 415,402 300,413",
    main: true,
  },
  {
    id: "office",
    label: "משרד",
    labelPos: [449, 362],
    labelSize: 12,
    points: "402,331 483,325 497,378 415,402",
    main: true,
  },

  // Left outbuildings ("מחסן" and "מכולה")
  { id: "shed-h2", label: "מחסן", labelPos: [84, 178], labelSize: 11, points: "51,175 96,155 117,201 73,221" },
  { id: "container-h1", label: "מכולה", labelPos: [115, 240], labelSize: 12, points: "122,205 151,236 96,291 66,261" },

  // Bottom right ("כלוב")
  { id: "cage", label: "כלוב", labelPos: [706, 434], labelSize: 20, points: "726,340 809,462 691,536 608,421" },

  // Upper right ("אוהל" and "מכולה")
  { id: "tent", label: "אוהל", labelPos: [832, 148], labelSize: 16, points: "894,18 980,108 791,274 708,175" },
  { id: "container-g1", label: "מכולה", labelPos: [901, 255], labelSize: 13, points: "915,210 955,251 869,333 829,291" },
];

export const DEFAULT_LOCATION_PINS: { name: string; room: string; x: number; y: number }[] = [
  // Main hall, bottom wall (above חדר פיסי)
  { name: "A1", room: "קרקס", x: 356, y: 312 },
  { name: "A2", room: "קרקס", x: 317, y: 312 },
  // Main hall, top entry wing
  { name: "B1", room: "קרקס", x: 318, y: 95 },
  { name: "B2", room: "קרקס", x: 285, y: 100 },
  { name: "B3", room: "קרקס", x: 233, y: 98 },
  // Main hall, left electronics alcove
  { name: "C1", room: "קרקס (אלק׳)", x: 247, y: 210 },
  { name: "C2", room: "קרקס (אלק׳)", x: 226, y: 183 },
  // Main hall, center floor
  { name: "D1", room: "קרקס", x: 359, y: 215 },
  { name: "D2", room: "קרקס", x: 311, y: 217 },
  // Bottom right
  { name: "E1", room: "כלוב", x: 706, y: 492 },
  { name: "E2", room: "כלוב", x: 765, y: 460 },
  // Main entrance
  { name: "F1", room: "כניסה", x: 506, y: 338 },
  // Right side
  { name: "G1", room: "מכולה (ימין)", x: 873, y: 291 },
  { name: "G2", room: "אוהל", x: 782, y: 142 },
  // Left side
  { name: "H1", room: "מכולה (שמאל)", x: 103, y: 263 },
  { name: "H2", room: "מחסן", x: 84, y: 198 },
];

const parsed = new Map(
  WORKSHOP_ROOMS.map((r) => [r.id, r.points.split(" ").map((p) => p.split(",").map(Number) as [number, number])]),
);

// The room a map point falls in (ray casting), for the pin's tooltip and the room glow.
export function roomAt(x: number, y: number): WorkshopRoom | null {
  // Smaller rooms first, so a point in סנס isn't read as קרקס.
  const order = [...WORKSHOP_ROOMS].reverse();
  for (const room of order) {
    const pts = parsed.get(room.id)!;
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return room;
  }
  return null;
}
