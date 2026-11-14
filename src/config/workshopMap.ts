// The workshop floor plan under the shop map (Harel, 2026-10-28), in the map's own units
// (viewBox 0 0 1000 560), traced from the labeled floor plan. Rooms are fixed; the zones drawn on
// top live in inventory_locations (Settings → Map, components/map/ShopMap.tsx).

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
