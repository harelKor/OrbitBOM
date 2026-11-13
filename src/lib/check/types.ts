// Design check (plan/design-check.md): checks that read the robot's 3D model in a CAD member's
// browser (no Onshape calls, nothing heavy on the server) and save what they found for the team.
// Phase 1 (Harel, 2026-11-13): weight, frame perimeter and height, interference.

// A robot's limits for the season and what the checks leave out, set on the CAD page by Edit mode.
// Empty means "no limit": the check still measures and shows the number.
export type CheckLimits = {
  weightKg?: number | null; // the robot without bumpers and battery, as the rules weigh it
  perimeterMm?: number | null; // the frame perimeter
  heightMm?: number | null; // standing height
  // Only what sits this high above the floor or lower makes the frame perimeter (the frame and
  // what's level with it); above it parts may stick out and are listed. Empty: the whole robot.
  frameZoneMm?: number | null;
  up?: "z" | "y" | "x"; // the model's up axis (Onshape's default is Z)
  exclude?: string[]; // systems left out of weight and size (the bumpers)
  budgets?: Record<string, number>; // a system's weight budget, kg
};

// One part's weight in the robot: `count` copies of `eachG` grams. Where the number comes from:
// set by hand, the mesh's volume times its material's density, or a guess (no material known:
// aluminium) that someone should check.
export type WeightSource = "set" | "material" | "printed" | "guess";
export type WeightPart = { key: string; name: string; systemId: string | null; count: number; eachG: number; source: WeightSource; material: string | null; cm3: number };
export type WeightResult = {
  totalG: number;
  bySystem: { systemId: string | null; g: number }[];
  parts: WeightPart[]; // heaviest (all copies together) first
};

// The robot seen from above. Lengths in mm; `hull` is the frame perimeter's corners (plan view).
export type EnvelopeResult = {
  perimeterMm: number; // the frame perimeter (the parts within the frame zone, or all of them)
  outlineMm: number; // every part's outline from above, sticking-out parts included
  lengthMm: number; // the frame's smallest box: its long side
  widthMm: number;
  heightMm: number;
  hull: [number, number][];
  out: { key: string; name: string; mm: number }[]; // parts reaching past the frame perimeter
};

// Two parts overlapping. `depthMm`: how far one pokes into the other (about); `at`: a point of
// the overlap in model mm, for the comment pin. `expected`: one of them is a screw, insert, gear,
// belt… where an overlap in CAD is usual (threads, teeth), listed apart.
// `flush`: they also share a face facing the same way (overlapping side by side, so the depth
// can read 0); `same`: one part placed twice in the same spot.
export type Clash = { a: string; b: string; aName: string; bName: string; depthMm: number; at: [number, number, number]; copies: number; expected: string | null; same?: boolean; flush?: boolean };

// Everything else the check finds (phases 2-6, Harel 2026-11-13), one shape for all: the parts
// it's about, what's wrong in plain words, a point to show (model mm) and how many places.
// `id` stays the same from run to run, so "It's fine" can be saved for it.
export type FindingKind = "floating" | "hole-offset" | "hole-size" | "screw-length" | "one-screw" | "access" | "plate" | "printed";
export type DesignFinding = {
  id: string;
  kind: FindingKind;
  keys: string[];
  names: string[];
  text: string;
  at: [number, number, number] | null;
  level: "warn" | "info"; // warn: likely a mistake; info: worth a look
  copies: number;
};
export const findingId = (code: string, keys: string[], extra = "") => [code, ...[...keys].sort(), extra].join("|");

export type CheckResults = {
  v: 1;
  weight: WeightResult;
  envelope: EnvelopeResult | null;
  clashes: Clash[];
  findings?: DesignFinding[]; // runs before phase 2 have none
  ms: number; // how long it took in the browser
};

// The saved run the page shows, with who ran it and on which model (its signature: a newer model
// means the results are old).
export type SavedCheck = { id: string; model: "final" | "basepart"; sig: string; ranAt: string; ranBy: string | null; results: CheckResults };

// The part pair a clash is about, order-free: the key an ignore is saved under.
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
