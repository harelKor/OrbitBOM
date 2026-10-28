// The inventory's starting categories and their fields (Harel, 2026-10-23: categories replace
// part types and material). They seed the inventory_categories table the first time it's read;
// after that the team edits them on the Inventory settings panel, the one exception to "no
// settings UI". `match` guesses an item's category from its name while none is set; it stays here
// because names are matched in code. Screws are tracked again, by size, head and length (Harel,
// 2026-10-27).

import type { CategoryField } from "@/db/schema";

// The big boxes above the categories (Harel, 2026-10-27). Each category belongs to one; the
// settings panel moves them. A category with an unknown group shows under General.
export const CATEGORY_GROUPS = [
  {
    id: "consumables",
    label: "Consumables",
    icon: "box",
    text: "Shafts, plates, tubes, filament",
  },
  {
    id: "electrical",
    label: "Electrical",
    icon: "spark",
    text: "Motors, controllers, sensors, wiring",
  },
  {
    id: "cots",
    label: "COTS",
    icon: "gear",
    text: "Wheels, gears, pulleys, bearings",
  },
  {
    id: "tools",
    label: "Tools",
    icon: "fab",
    text: "Fasteners, hand and power tools",
  },
  {
    id: "bumpers",
    label: "Bumpers & Field",
    icon: "cube",
    text: "Bumper materials, field elements",
  },
  { id: "general", label: "General", icon: "more", text: "Everything else" },
] as const;

export type CategoryGroupId = (typeof CATEGORY_GROUPS)[number]["id"];
export const DEFAULT_GROUP: CategoryGroupId = "general";
export const isCategoryGroup = (id: string): id is CategoryGroupId =>
  CATEGORY_GROUPS.some((g) => g.id === id);
export const groupOf = (group: string | null | undefined): CategoryGroupId =>
  group && isCategoryGroup(group) ? group : DEFAULT_GROUP;

export type CategorySeed = {
  id: string;
  label: string;
  noun: string;
  group: CategoryGroupId;
  sheet?: boolean;
  fields: CategoryField[];
  match: RegExp | null;
  image?: string; // a picture in public/categories/ (a path starting with "/"), or an R2 key
};

const BORES = [
  '1/2" Hex',
  '3/8" Hex',
  '1/2" ThunderHex',
  "SplineXS",
  "SplineXL",
  "8mm",
  '1/2" Round',
  "5mm",
];
const PITCHES = ["GT2 3mm", "HTD 5mm"];

const teeth: CategoryField = {
  id: "teeth",
  label: "Teeth",
  kind: "number",
  name: "{}T",
};
const bore: CategoryField = {
  id: "bore",
  label: "Bore",
  kind: "options",
  options: BORES,
};
const length: CategoryField = {
  id: "length",
  label: "Length (mm)",
  kind: "number",
  name: "{}mm",
};

// Fields added 2026-10-28 (Harel: sizes were stuck in names and notes); lib/inventory/specBackfill.ts
// copied them into the live categories and filled the items' values.
const wall: CategoryField = {
  id: "wall",
  label: "Wall (mm)",
  kind: "text",
  name: "{}mm wall",
};
const color: CategoryField = { id: "color", label: "Color", kind: "text" };
const size: CategoryField = { id: "size", label: "Size", kind: "text" };
const countedIn: CategoryField = {
  id: "unit",
  label: "Counted in",
  kind: "options",
  options: ["Meters", "Feet"],
  name: "",
};

export const DEFAULT_CATEGORIES: CategorySeed[] = [
  {
    id: "gears",
    group: "cots",
    label: "Gears",
    image: "/categories/gears.png",
    noun: "Gear",
    match: /\bgears?\b/i,
    fields: [
      teeth,
      { id: "dp", label: "DP", kind: "options", options: ["20 DP", "32 DP"] },
      { ...bore, options: [...BORES, "SIM shaft", '1.125" Bearing'] },
      {
        id: "type",
        label: "Type",
        kind: "options",
        options: ["Spur", "Bevel", "Ball shifter"],
        name: "",
      },
      {
        id: "material",
        label: "Material",
        kind: "options",
        options: ["Aluminum", "Steel", "Plastic"],
        name: "",
      },
    ],
  },
  {
    id: "pulleys",
    group: "cots",
    label: "Pulleys",
    image: "/categories/pulleys.png",
    noun: "Pulley",
    match: /pulley/i,
    fields: [
      teeth,
      { id: "pitch", label: "Pitch", kind: "options", options: PITCHES },
      { id: "width", label: "Width (mm)", kind: "number", name: "{}mm wide" },
      { ...bore, options: [...BORES, "Kraken spline", "Falcon spline"] },
    ],
  },
  {
    id: "sprockets",
    group: "cots",
    label: "Sprockets",
    image: "/categories/sprockets.png",
    noun: "Sprocket",
    match: /sprocket/i,
    fields: [
      teeth,
      { id: "chain", label: "Chain", kind: "options", options: ["#25", "#35"] },
      bore,
      { id: "boreSize", label: "Bore size", kind: "text", name: "{} bore" },
      { id: "thickness", label: "Thickness", kind: "text", name: "{} thick" },
    ],
  },
  {
    id: "belts",
    group: "cots",
    label: "Belts",
    image: "/categories/belts.png",
    noun: "Belt",
    match: /\bbelts?\b|htd|gt2|timing/i,
    fields: [
      teeth,
      { id: "pitch", label: "Pitch", kind: "options", options: PITCHES },
      { id: "width", label: "Width (mm)", kind: "number", name: "{}mm wide" },
      { id: "length", label: "Length (mm)", kind: "number", name: "{}mm" },
      {
        id: "sides",
        label: "Sides",
        kind: "options",
        options: ["Single", "Double-sided"],
        name: "",
      },
    ],
  },
  {
    id: "bearings",
    group: "cots",
    label: "Bearings",
    image: "/categories/bearings.png",
    noun: "Bearing",
    match: /bearing|bushing/i,
    fields: [
      {
        id: "bore",
        label: "Bore",
        kind: "options",
        options: [...BORES, '3/8" Round', '1/4" Round'],
      },
      { id: "id", label: "ID", kind: "text", name: "{} ID" },
      { id: "od", label: "OD", kind: "text", name: "{} OD" },
      { id: "width", label: "Width", kind: "text", name: "{} wide" },
      {
        id: "flanged",
        label: "Flanged",
        kind: "options",
        options: ["Flanged", "Radial"],
      },
    ],
  },
  {
    id: "shafts",
    group: "consumables",
    label: "Shafts",
    noun: "Shaft",
    match: /shaft|hex\s*stock|axle/i,
    fields: [
      {
        id: "profile",
        label: "Profile",
        kind: "options",
        options: [
          '1/2" Hex',
          '3/8" Hex',
          '1/2" ThunderHex',
          '3/8" ThunderHex',
          "Round",
        ],
      },
      length,
    ],
  },
  {
    id: "motors",
    group: "electrical",
    label: "Motors",
    noun: "",
    match: /motor|\bneo\b|vortex|falcon|kraken|\bcim\b|\b775\b|minion|\bbag\b/i,
    fields: [
      {
        id: "model",
        label: "Model",
        kind: "options",
        options: [
          "Kraken X60",
          "Kraken X44",
          "NEO Vortex",
          "NEO",
          "NEO 550",
          "Falcon 500",
          "Minion",
          "CIM",
          "775pro",
        ],
      },
    ],
  },
  {
    id: "wheels",
    group: "cots",
    label: "Wheels",
    noun: "Wheel",
    match: /wheel|omni|mecanum|colson|traction|compliant|stealth|tread/i,
    fields: [
      {
        id: "diameter",
        label: "Diameter",
        kind: "options",
        options: [
          '1"',
          '1.5"',
          '1 5/8"',
          '2"',
          '2.25"',
          '2.5"',
          '3"',
          '4"',
          '5"',
          '6"',
          '8"',
        ],
      },
      {
        id: "type",
        label: "Type",
        kind: "options",
        options: [
          "Traction",
          "Omni",
          "Mecanum",
          "Compliant",
          "Colson",
          "Stealth",
          "Star",
          "Flex",
          "Sushi",
          "Pneumatic",
          "Silicone tubing",
          "Tread",
          "Flywheel",
        ],
      },
      bore,
      { id: "width", label: "Width", kind: "text", name: "{} wide" },
      color,
    ],
  },
  {
    id: "round-tubes",
    group: "consumables",
    label: "Round tubes",
    noun: "Tube",
    match: /round\s*tube|\btube\b.*\bod\b|\bod\b.*\btube\b|\bpipe\b/i,
    fields: [
      {
        id: "material",
        label: "Material",
        kind: "material",
        materials: [
          "Aluminum Tubes",
          "Polycarbonate Tubes",
          "Carbon Fiber Tubes",
        ],
      },
      { id: "od", label: "OD (mm)", kind: "number", name: "Ø{}mm" },
      wall,
      length,
    ],
  },
  {
    id: "square-tubes",
    group: "consumables",
    label: "Square tubes",
    noun: "Box tube",
    match:
      /(box|square|rect\w*)\s*tube|\btube\b.*\d+\s*x\s*\d+|\d+\s*x\s*\d+.*\btube\b|extrusion/i,
    fields: [
      {
        id: "material",
        label: "Material",
        kind: "material",
        materials: ["Aluminum Extrusions"],
      },
      { id: "size", label: "Size (mm)", kind: "text", name: "{}mm" },
      wall,
      length,
    ],
  },
  {
    id: "carbon-tubes",
    group: "consumables",
    label: "Carbon tubes",
    noun: "Carbon tube",
    match: /carbon|קרבון/i,
    fields: [
      {
        id: "shape",
        label: "Shape",
        kind: "options",
        options: ["Round", "Square"],
      },
      { id: "od", label: "OD", kind: "text", name: "Ø{}" },
      { id: "wall", label: "Wall (mm)", kind: "text", name: "{}mm wall" },
      {
        id: "length",
        label: "Length",
        kind: "options",
        options: ["500mm", "700mm"],
      },
    ],
  },
  {
    id: "aluminum-plates",
    group: "consumables",
    label: "Aluminum plates",
    noun: "Plate",
    sheet: true,
    match:
      /alumin\w*.*(plate|sheet)|(plate|sheet).*alumin|\b(6061|5052|7075)\b/i,
    fields: [
      {
        id: "material",
        label: "Material",
        kind: "material",
        materials: ["Aluminum Plates"],
      },
      { id: "size", label: "Sheet size (mm)", kind: "text", name: "{}mm" },
    ],
  },
  {
    id: "polycarbonate",
    group: "consumables",
    label: "Polycarbonate plates",
    noun: "Plate",
    sheet: true,
    match: /polycarb|lexan|\bpoly\b|\bpc\b/i,
    fields: [
      {
        id: "material",
        label: "Material",
        kind: "material",
        materials: ["Polycarbonate Plates"],
      },
      { id: "size", label: "Sheet size (mm)", kind: "text", name: "{}mm" },
    ],
  },
  {
    id: "wood-composites",
    group: "consumables",
    label: "Wood & composites",
    noun: "Sheet",
    sheet: true,
    match: /plywood|birch|\bmdf\b|srpp|sandwich|בירץ|סנדוויץ/i,
    fields: [
      {
        id: "material",
        label: "Material",
        kind: "options",
        options: ["Birch", "Sandwich", "MDF", "SRPP"],
      },
      {
        id: "thickness",
        label: "Thickness (mm)",
        kind: "number",
        name: "{}mm",
      },
      { id: "size", label: "Sheet size (mm)", kind: "text", name: "{}mm" },
    ],
  },
  {
    id: "electrical",
    group: "electrical",
    label: "Electrical",
    noun: "",
    match: /fuse|breaker|roborio|\bpdh\b|\bpdp\b|\bvrm\b|\brsl\b|radio/i,
    fields: [
      {
        id: "kind",
        label: "Kind",
        kind: "options",
        options: [
          "Wire",
          "Connector",
          "Motor controller",
          "Sensor",
          "Breaker",
          "Battery",
          "Other",
        ],
        name: "",
      },
      { id: "size", label: "Gauge / size", kind: "text" },
    ],
  },
  {
    id: "filament",
    group: "consumables",
    label: "Filament",
    noun: "Filament",
    match: /filament|\bpla\b|petg|\babs\b|onyx|\btpu\b/i,
    fields: [
      {
        id: "material",
        label: "Material",
        kind: "material",
        materials: ["3D Printed"],
      },
      { id: "color", label: "Color", kind: "text" },
    ],
  },
  // Added 2026-10-27 with the groups; 0032 inserts them for teams already seeded.
  {
    id: "shop-supplies",
    group: "consumables",
    label: "Shop supplies",
    noun: "",
    match: /zip\s*tie|tape|loctite|grease|\brivets?\b|epoxy|glue|lubric/i,
    fields: [size, countedIn],
  },
  {
    id: "controllers",
    group: "electrical",
    label: "Controllers & sensors",
    noun: "",
    match:
      /spark\s*(max|flex)|talon|victor|controller|encoder|sensor|limelight|candle|canivore|pigeon|navx|gyro|camera|beam\s*break/i,
    fields: [],
  },
  {
    id: "wiring",
    group: "electrical",
    label: "Wiring & connectors",
    noun: "",
    match: /wire|cable|connector|wago|anderson|ferrule|heat\s*shrink|\bawg\b/i,
    fields: [
      {
        id: "kind",
        label: "Kind",
        kind: "options",
        options: [
          "Wire",
          "Cable",
          "Ferrule",
          "Ring terminal",
          "Lug",
          "Connector",
          "Contact",
          "Housing",
          "Resistor",
          "Loom",
          "Other",
        ],
        name: "",
      },
      { id: "gauge", label: "Gauge (AWG)", kind: "text", name: "{} AWG" },
      countedIn,
    ],
  },
  {
    id: "batteries",
    group: "electrical",
    label: "Batteries",
    noun: "Battery",
    match: /batter/i,
    fields: [],
  },
  // Added 2026-10-27 for the shop spreadsheet; 0035 inserts them for teams already seeded.
  {
    id: "pinions-adapters",
    group: "cots",
    label: "Pinions & adapters",
    image: "/categories/pinions-adapters.png",
    noun: "",
    match:
      /pinion|spline\s*(xs|xl)?\s*adapter|falcon\s*(spline|shaft)|motor\s*(gear|pulley)/i,
    fields: [
      teeth,
      {
        id: "dp",
        label: "DP / pitch",
        kind: "options",
        options: ["10 DP", "20 DP", "32 DP", "HTD 5mm", "GT2 3mm"],
      },
      {
        id: "kind",
        label: "Kind",
        kind: "options",
        options: ["Pinion", "Pulley", "Adapter"],
        name: "",
      },
      {
        id: "spline",
        label: "Spline",
        kind: "options",
        options: [
          "SplineXS",
          "Falcon",
          "Kraken",
          "RS775",
          '1/2" Hex',
          '3/8" Hex',
        ],
      },
    ],
  },
  {
    id: "gearboxes",
    group: "cots",
    label: "Gearboxes",
    noun: "",
    match: /gearbox|planetary|cycloid|versa\s*planetary|maxplanetary/i,
    fields: [
      {
        id: "type",
        label: "Type",
        kind: "options",
        options: ["MAXPlanetary", "VersaPlanetary", "Cycloidal", "Other"],
      },
      { id: "ratio", label: "Ratio", kind: "text", name: "{}" },
    ],
  },
  {
    id: "chain",
    group: "cots",
    label: "Chain",
    noun: "Chain",
    match: /\bchain\b/i,
    fields: [
      { id: "chain", label: "Chain", kind: "options", options: ["#25", "#35"] },
    ],
  },
  {
    id: "hubs-spacers",
    group: "cots",
    label: "Hubs & spacers",
    noun: "",
    match: /\bhubs?\b|spacer|shaft\s*collar|collar/i,
    fields: [],
  },
  {
    id: "fasteners",
    group: "tools",
    label: "Fasteners",
    noun: "",
    match:
      /screw|bolt|\bnuts?\b|washer|standoff|\bshcs\b|\bbhcs\b|rivet|ניט|בורג|ברגי/i,
    fields: [
      { id: "size", label: "Size", kind: "text" },
      {
        id: "head",
        label: "Head",
        kind: "options",
        options: ["Socket", "Button", "Flat", "Rivet", "Rivet, large head"],
      },
      { id: "length", label: "Length (mm)", kind: "text" },
    ],
  },
  {
    id: "cnc-bits",
    group: "tools",
    label: "CNC bits",
    noun: "",
    match: /end\s*mill|chamfer|thread\s*mill|collet|\bflute\b|כרסום|קולט/i,
    fields: [
      { id: "type", label: "Type", kind: "text" },
      { id: "size", label: "Size", kind: "text" },
    ],
  },
  {
    id: "lathe-tools",
    group: "tools",
    label: "Lathe tools",
    noun: "",
    match: /lathe|insert|boring\s*bar|parting|tailstock|מחרטה|גודעת/i,
    fields: [
      {
        id: "for",
        label: "For",
        kind: "options",
        options: ["Aluminum", "Steel"],
      },
    ],
  },
  {
    id: "drills-taps",
    group: "tools",
    label: "Drills & taps",
    noun: "",
    match: /drill\s*bit|\btaps?\b|מקדח|מברז/i,
    fields: [
      {
        id: "kind",
        label: "Kind",
        kind: "options",
        options: ["Drill bit", "Tap"],
      },
      { id: "size", label: "Size", kind: "text" },
    ],
  },
  {
    id: "hand-tools",
    group: "tools",
    label: "Hand tools",
    noun: "",
    match:
      /wrench|allen|hex\s*key|plier|screwdriver|crimper|stripper|\bfiles?\b|hammer|caliper/i,
    fields: [size],
  },
  {
    id: "power-tools",
    group: "tools",
    label: "Power tools & bits",
    noun: "",
    match: /drill|\bbits?\b|saw|blade|grinder|end\s*mill|router/i,
    fields: [],
  },
  {
    id: "bumper-materials",
    group: "bumpers",
    label: "Bumper materials",
    noun: "",
    match: /bumper|pool\s*noodle|plywood|cordura|fabric/i,
    fields: [],
  },
  {
    id: "field-elements",
    group: "bumpers",
    label: "Field elements",
    noun: "",
    match: /field\s*element|game\s*piece|\bfield\b/i,
    fields: [],
  },
  {
    id: "other",
    group: "general",
    label: "Other",
    noun: "",
    match: null,
    fields: [],
  },
];

const MATCH = new Map(DEFAULT_CATEGORIES.map((c) => [c.id, c.match]));

// A guess from an item's name among the team's categories: the first whose name pattern fits.
export function guessCategory(
  name: string,
  categoryIds: string[],
): string | null {
  for (const id of categoryIds) if (MATCH.get(id)?.test(name)) return id;
  return null;
}
