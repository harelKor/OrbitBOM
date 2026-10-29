// The inventory's starting categories and their fields (Harel, 2026-10-23: categories replace
// part types and material). They seed the inventory_categories table the first time it's read;
// after that the team edits them on the Settings page. `match` guesses an item's category from
// its name while none is set; it stays here because names are matched in code.
//
// Since 2026-10-28 (Harel) the shop has 5 groups, and a category with several kinds of things in
// it (glues and tapes, hand tools, wiring...) starts with a `type` field: fields with `when` only
// apply to the types they name (at most 2 per type), see activeFields in lib/inventory/categories.ts.

import type { CategoryField } from "@/db/schema";

// The big boxes above the categories. Each category belongs to one; the Settings page moves them.
// A category with an unknown group shows under Hardware & Assembly.
export const CATEGORY_GROUPS = [
  {
    id: "cots",
    short: "COTS", // the add form's group pill
    label: "COTS & Motion",
    icon: "cog",
    text: "Gears, pulleys, belts, bearings, wheels, hubs, gearboxes",
  },
  {
    id: "consumables",
    short: "Raw Stock", // the add form's group pill
    label: "Raw Stock",
    icon: "layers",
    text: "Plates, box & round tubes, carbon, shafts, 3D filament",
  },
  {
    id: "hardware",
    short: "Hardware", // the add form's group pill
    label: "Hardware & Assembly",
    icon: "cube",
    text: "Screws, rivets, tapes, glues, zip ties, rigging",
  },
  {
    id: "electrical",
    short: "Electrical", // the add form's group pill
    label: "Electrical & Control",
    icon: "bolt",
    text: "Motors, controllers, sensors, breakers, fuses, wiring",
  },
  {
    id: "tools",
    short: "Tools", // the add form's group pill
    label: "Shop & Machining Tools",
    icon: "wrench",
    text: "CNC bits, lathe cutters, drills, taps, hand tools",
  },
] as const;

export type CategoryGroupId = (typeof CATEGORY_GROUPS)[number]["id"];
export const DEFAULT_GROUP: CategoryGroupId = "hardware";
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
// Motor shafts, for pinion gears and motor pulleys (they live in Gears and Pulleys).
const MOTOR_BORES = ["8mm SplineXS", "Falcon", "Kraken", "RS775", "CIM"];
// Bearing bores: the inch hex and round ones first, then the shop's metric sizes, each once.
// Metric sizes are bare millimetres, so a bearing reads "8x16x5" (Harel, 2026-10-29).
const BEARING_BORES = [
  '1/2" Hex',
  '3/8" Hex',
  '1/2" ThunderHex',
  '3/8" ThunderHex',
  '1/2" Round',
  '3/8" Round',
  '1/4" Round',
  '3/4" Round',
  '0.6" Round',
  "3",
  "4",
  "5",
  "6",
  "6.35",
  "7",
  "8",
  "9",
  "9.5",
  "10",
  "12",
  "15",
  "17",
  "20",
  "25",
  "30",
];
const THREADS = ["M3", "M4", "M5", "M6", "#10-32", "#8-32"];
const AWG = [
  "4 AWG",
  "6 AWG",
  "10 AWG",
  "12 AWG",
  "14 AWG",
  "16 AWG",
  "18 AWG",
  "20 AWG",
  "22 AWG",
  "24 AWG",
  "CAN",
];

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
const wall: CategoryField = {
  id: "wall",
  label: "Wall (mm)",
  kind: "text",
  name: "{}mm wall",
};
const thickness: CategoryField = {
  id: "thickness",
  label: "Thickness (mm)",
  kind: "number",
  name: "{}mm",
};
const sheetSize: CategoryField = {
  id: "size",
  label: "Sheet size (mm)",
  kind: "text",
  name: "{}mm",
};
const typeField = (options: string[]): CategoryField => ({
  id: "type",
  label: "Type",
  kind: "options",
  options,
  name: "",
});

export const DEFAULT_CATEGORIES: CategorySeed[] = [
  // COTS & Motion
  {
    id: "gears",
    group: "cots",
    label: "Gears",
    image: "/categories/gears.png",
    noun: "Gear",
    match: /\bgears?\b|pinion/i,
    fields: [
      teeth,
      {
        id: "dp",
        label: "DP",
        kind: "options",
        options: ["10 DP", "12 DP", "20 DP", "32 DP"],
      },
      { ...bore, options: [...BORES, ...MOTOR_BORES, '1.125" Bearing'] },
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
      { ...bore, options: [...BORES, ...MOTOR_BORES] },
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
      { id: "pitch", label: "Pitch", kind: "options", options: PITCHES },
      teeth,
      { id: "width", label: "Width (mm)", kind: "number", name: "{}mm wide" },
      {
        id: "groove",
        label: "Groove",
        kind: "options",
        options: ["Single", "Double-sided"],
        name: "",
      },
    ],
  },
  {
    id: "sprockets",
    group: "cots",
    label: "Sprockets",
    image: "/categories/sprockets.png",
    noun: "Sprocket",
    match: /sprocket|chain/i,
    fields: [
      { id: "chain", label: "Chain", kind: "options", options: ["#25", "#35"] },
      teeth,
      bore,
    ],
  },
  {
    id: "bearings",
    group: "cots",
    label: "Bearings",
    image: "/categories/bearings.png",
    noun: "Bearing",
    // A bare size ("8x16x5", "8×16×5mm flanged") is a bearing too.
    match:
      /bearing|bushing|מיסב|^\s*\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?\s*(?:mm)?(?:\s+(?:flanged?|radial|פלאנג\S*))?\s*$/i,
    fields: [
      // Filters and names read ID x OD x Thick, then Type: "8x16x5 Flanged Bearing"
      // (Harel, 2026-10-29). Metric values are bare millimetres, inch ones keep their ".
      {
        id: "bore",
        label: "ID",
        kind: "options",
        options: BEARING_BORES,
      },
      { id: "od", label: "OD", kind: "text", name: "{} OD" },
      { id: "width", label: "Thick", kind: "text", name: "{} thick" },
      {
        id: "flanged",
        label: "Type",
        kind: "options",
        options: ["Flanged", "Radial"],
      },
    ],
  },
  {
    id: "wheels",
    group: "cots",
    label: "Wheels & rollers",
    noun: "Wheel",
    match:
      /wheel|omni|mecanum|colson|traction|compliant|stealth|tread|roller|silicone\s*tubing/i,
    fields: [
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
      bore,
      { id: "durometer", label: "Durometer", kind: "text" },
    ],
  },
  {
    id: "hubs-adapters",
    group: "cots",
    label: "Hubs, adapters & spacers",
    image: "/categories/hubs-adapters.png",
    noun: "",
    match:
      /\bhubs?\b|spacer|shaft\s*collar|collar|adapter|775\s*connect|bearing\s*block/i,
    fields: [
      {
        id: "kind",
        label: "Kind",
        kind: "options",
        options: ["Hex Hub", "Shaft Adapter", "Spacer", "Bearing Block"],
        name: "",
      },
      { ...bore, options: [...MOTOR_BORES, ...BORES] },
    ],
  },
  {
    id: "gearboxes",
    group: "cots",
    label: "Gearboxes & planetaries",
    noun: "",
    match: /gearbox|planetary|cycloid|versa\s*planetary|maxplanetary/i,
    fields: [
      {
        id: "system",
        label: "System",
        kind: "options",
        options: ["MaxPlanetary", "VersaPlanetary", "Cycloidal", "Other"],
      },
      { id: "ratio", label: "Ratio", kind: "text", name: "{}" },
    ],
  },
  // A COTS part that fits no category lands here (the COTS page needs a box for it).
  {
    id: "other",
    group: "cots",
    label: "Other",
    noun: "",
    match: null,
    fields: [],
  },

  // Raw Stock
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
      thickness,
      sheetSize,
    ],
  },
  {
    id: "polycarbonate",
    group: "consumables",
    label: "Polycarbonate plates",
    noun: "Plate",
    sheet: true,
    match: /polycarb|lexan|\bpoly\b|\bpc\b/i,
    fields: [thickness, sheetSize],
  },
  {
    id: "wood-composites",
    group: "consumables",
    label: "Wood & composite sheets",
    noun: "Sheet",
    sheet: true,
    match: /plywood|birch|\bmdf\b|srpp|sandwich|בירץ|סנדוויץ/i,
    fields: [
      {
        id: "material",
        label: "Material",
        kind: "options",
        options: ["Birch", "Sandwich/Plywood", "MDF", "SRPP"],
      },
      thickness,
      sheetSize,
    ],
  },
  {
    id: "square-tubes",
    group: "consumables",
    label: "Box tubes & extrusions",
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
    id: "carbon-tubes",
    group: "consumables",
    label: "Carbon fiber tubes",
    noun: "Carbon tube",
    match: /carbon|קרבון/i,
    fields: [
      { id: "od", label: "OD", kind: "text", name: "Ø{}" },
      wall,
      {
        id: "length",
        label: "Length",
        kind: "options",
        options: ["500mm", "700mm"],
      },
    ],
  },
  {
    id: "shafts",
    group: "consumables",
    label: "Shaft stock",
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
    id: "filament",
    group: "consumables",
    label: "3D printing & filament",
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

  // Hardware & Assembly
  {
    id: "rivets",
    group: "hardware",
    label: "Rivets",
    noun: "Rivet",
    match: /rivet|ניט/i,
    fields: [
      {
        id: "diameter",
        label: "Diameter",
        kind: "options",
        options: ['4mm (5/32")', '5mm (3/16")'],
      },
      {
        id: "head",
        label: "Head",
        kind: "options",
        options: ["Standard", "Large head (ראש גדול)"],
        name: "",
      },
      length,
    ],
  },
  {
    id: "fasteners",
    group: "hardware",
    label: "Screws & nuts",
    noun: "",
    match:
      /screw|bolt|\bnuts?\b|washer|standoff|\bshcs\b|\bbhcs\b|בורג|ברגי|\bm[3-8]\s*[x×]\s*\d+/i,
    fields: [
      {
        id: "kind",
        label: "Kind",
        kind: "options",
        options: [
          "SHCS (רגיל)",
          "Button Head (כיפה)",
          "Flat Head (קוני)",
          "Wood Screw",
          "Nut / Washer",
        ],
        name: "",
      },
      { id: "thread", label: "Thread", kind: "options", options: THREADS },
      length,
    ],
  },
  {
    id: "adhesives-tapes",
    group: "hardware",
    label: "Tapes, glues & chemicals",
    noun: "",
    match:
      /tape|glue|epoxy|loctite|\bca\b|acetone|alcohol|lubric|grease|solvent|spray|אפוקסי|דבק|טייפ|איזו/i,
    fields: [
      typeField(["Glue", "Loctite", "Tape", "Spray & Solvent"]),
      {
        id: "glue",
        label: "Kind",
        kind: "options",
        options: ["Epoxy", "Super Glue (CA)", "Structural", "Hot Glue"],
        when: "Glue",
      },
      {
        id: "cure",
        label: "Cure",
        kind: "options",
        options: ["Instant", "5 Min", "15 Min", "24 Hr"],
        when: "Glue",
      },
      {
        id: "grade",
        label: "Grade",
        kind: "options",
        options: ["Blue (Medium)", "Red (Strong)", "Purple (Low)", "Green"],
        when: "Loctite",
      },
      {
        id: "tape",
        label: "Kind",
        kind: "options",
        options: [
          "Duct Tape",
          "Electrical",
          "VHB / Double-Sided",
          "Kapton",
          "Masking",
        ],
        when: "Tape",
      },
      {
        id: "width",
        label: "Width (mm)",
        kind: "number",
        name: "{}mm",
        when: "Tape",
      },
    ],
  },
  {
    id: "rigging-ties",
    group: "hardware",
    label: "Zip ties, rope & rigging",
    noun: "",
    match: /zip\s*tie|rope|dyneema|velcro|elastic|surgical\s*tub|אזיקון|חוט/i,
    fields: [
      typeField(["Zip Tie", "Rope", "Tube / Elastic", "Velcro"]),
      {
        id: "size",
        label: "Size",
        kind: "options",
        options: ["Small", "Medium", "Large", "Heavy Duty"],
        when: "Zip Tie",
      },
      {
        id: "diameter",
        label: "Diameter (mm)",
        kind: "number",
        name: "Ø{}mm",
        when: "Rope",
      },
      {
        id: "length",
        label: "Length (m)",
        kind: "number",
        name: "{}m",
        when: "Rope",
      },
    ],
  },

  // Electrical & Control
  {
    id: "motors",
    group: "electrical",
    label: "Motors & servos",
    noun: "",
    match: /motor|servo|\bneo\b|vortex|falcon|kraken|\bcim\b|\b775\b|minion|\bbag\b/i,
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
    id: "controllers",
    group: "electrical",
    label: "Controllers & modules",
    noun: "",
    match:
      /spark\s*(max|flex)|talon|victor|controller|roborio|\bpdh\b|\bpdp\b|\bvrm\b|\brsl\b|radio|canivore|candi|canifier|candle|switch|orange\s*pi|led/i,
    fields: [],
  },
  {
    id: "sensors",
    group: "electrical",
    label: "Sensors & vision",
    noun: "",
    match:
      /sensor|encoder|limelight|camera|pigeon|navx|gyro|cancoder|beam\s*break|limit\s*switch|hall\s*effect/i,
    fields: [],
  },
  {
    id: "power-distribution",
    group: "electrical",
    label: "Breakers, fuses & batteries",
    noun: "",
    match: /breaker|fuse|batter|פיוז|מצבר/i,
    fields: [
      typeField(["Fuse / Snap Breaker", "Main Breaker", "Battery"]),
      {
        id: "rating",
        label: "Rating",
        kind: "options",
        options: ["7.5A", "10A", "15A", "20A", "25A", "30A", "40A", "120A"],
        when: ["Fuse / Snap Breaker", "Main Breaker"],
      },
    ],
  },
  {
    id: "wiring",
    group: "electrical",
    label: "Wires, connectors & terminals",
    noun: "",
    match:
      /wire|cable|connector|wago|anderson|ferrule|heat\s*shrink|\bawg\b|terminal|lug|כבל|סופי/i,
    fields: [
      typeField([
        "Wire",
        "Connector",
        "Ferrule (סופית)",
        "Ring Terminal (נעל כבל)",
        "Heat Shrink",
      ]),
      {
        id: "awg",
        label: "Gauge",
        kind: "options",
        options: AWG,
        when: ["Wire", "Ferrule (סופית)", "Ring Terminal (נעל כבל)"],
      },
      { id: "color", label: "Color", kind: "text", when: "Wire" },
      {
        id: "series",
        label: "Series",
        kind: "options",
        options: ["Anderson", "SB50", "Wago", "Weidmüller", "PWM / CAN"],
        when: "Connector",
      },
      {
        id: "size",
        label: "Size",
        kind: "text",
        when: ["Ferrule (סופית)", "Ring Terminal (נעל כבל)"],
      },
    ],
  },

  // Shop & Machining Tools
  {
    id: "cnc-bits",
    group: "tools",
    label: "CNC & router bits",
    noun: "",
    match: /end\s*mill|chamfer|thread\s*mill|collet|\bflute\b|כרסום|קולט/i,
    fields: [
      {
        id: "kind",
        label: "Kind",
        kind: "options",
        options: [
          "Single Flute",
          "Single Flute Long",
          "Chamfer",
          "Reverse Chamfer",
          "Thread Mill",
          "Collet",
        ],
        name: "",
      },
      { id: "size", label: "Size", kind: "text" },
    ],
  },
  {
    id: "lathe-tools",
    group: "tools",
    label: "Lathe cutters & inserts",
    noun: "",
    match: /lathe|insert|boring\s*bar|parting|tailstock|מחרטה|גודעת/i,
    fields: [
      {
        id: "kind",
        label: "Kind",
        kind: "options",
        options: [
          "Light Cutter",
          "Rough Cutter",
          "Parting",
          "Internal",
          "C-Clip",
          "Threading",
          "Holder",
          "Center",
        ],
        name: "",
      },
      {
        id: "material",
        label: "Material",
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
    match: /drill|\btaps?\b|מקדח|מברז/i,
    fields: [
      typeField(["Drill Bit", "Tap"]),
      {
        id: "size",
        label: "Size (mm)",
        kind: "number",
        name: "Ø{}mm",
        when: "Drill Bit",
      },
      {
        id: "thread",
        label: "Thread",
        kind: "options",
        options: [...THREADS.slice(0, 4), "M8", ...THREADS.slice(4), '1/4"-20'],
        when: "Tap",
      },
    ],
  },
  {
    id: "hand-tools",
    group: "tools",
    label: "Hand, power & measuring tools",
    noun: "",
    match:
      /wrench|allen|hex\s*key|torx|plier|screwdriver|crimper|stripper|cutter|\bfiles?\b|hammer|caliper|socket|measure|scale|level|multimeter|riveter|dremel|heat\s*gun|soldering|אלן|מפתח|קליבר/i,
    fields: [
      typeField([
        "Allen Key",
        "Wrench",
        "Crimper",
        "Pliers & Cutters",
        "Measuring",
      ]),
      {
        id: "size",
        label: "Size",
        kind: "text",
        when: ["Allen Key", "Wrench"],
      },
      {
        id: "keyStyle",
        label: "Style",
        kind: "options",
        options: ["T-Handle", "L-Key", "Ball-End", "Set"],
        when: "Allen Key",
      },
      {
        id: "wrenchStyle",
        label: "Style",
        kind: "options",
        options: ["Combination", "Ratchet", "Socket", "Adjustable"],
        when: "Wrench",
      },
      {
        id: "for",
        label: "For",
        kind: "options",
        options: ["Anderson", "Ferrule (סופיות)", "Ring Terminal", "Stripper"],
        when: "Crimper",
      },
    ],
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
