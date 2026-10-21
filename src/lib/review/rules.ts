// Suggest setup's rules (plan §6, "Recognising part types"): material from Onshape's own
// material and the part's measured size, processes from what the team usually does with that
// material. No AI runs on the server; parts these rules can't place are left for the member's
// Claude, through the MCP server, or the designer.

import { DEFAULT_PROCESSES, PLATE_TOLERANCE_MM, type ProcessSet } from "@/config/autoSetup";
import { getMachine } from "@/config/machines";
import { MATERIALS, materialCategory, plateThicknessMm } from "@/config/materials";
import type { PartGeometry } from "@/db/schema";

export type SetupInput = {
  classification: "inhouse" | "cots" | "external";
  material: string | null;
  preProcess: string | null;
  process1: string | null;
  process2: string | null;
  geometry: PartGeometry | null;
};

export type SetupChanges = {
  classification?: "inhouse";
  material?: string;
  preProcess?: string | null;
  process1?: string | null;
  process2?: string | null;
};

// Learned processes: the most common process set per material on the team's parts.
export type Learned = Map<string, ProcessSet & { count: number }>;

const PRINTED: [RegExp, string][] = [
  [/\bpla\b/i, "PLA"],
  [/\bonyx\b/i, "Onyx"],
  [/\bpa ?6?12\b|nylon ?12/i, "PA612"],
];

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

// The plate of `category` whose thickness matches the part's smallest side, if the part is flat.
function plateFor(category: string, bbox: [number, number, number] | undefined) {
  if (!bbox) return undefined;
  const [t, mid] = bbox;
  if (t <= 0 || t > mid * 0.25) return undefined;
  return MATERIALS[category].find((m) => {
    const thk = plateThicknessMm(m);
    return thk !== undefined && Math.abs(thk - t) <= PLATE_TOLERANCE_MM;
  });
}

export function materialGuess(part: SetupInput): { material: string; why: string } | undefined {
  const om = part.geometry?.onshapeMaterial ?? "";
  const bbox = part.geometry?.bbox;
  const thick = bbox ? `${fmt(bbox[0])} mm thick` : "";
  if (/alumin/i.test(om)) {
    const m = plateFor("Aluminum Plates", bbox);
    if (m) return { material: m, why: `Onshape material ${om}, flat and ${thick}` };
  }
  if (/polycarb/i.test(om)) {
    const m = plateFor("Polycarbonate Plates", bbox);
    if (m) return { material: m, why: `Onshape material ${om}, flat and ${thick}` };
  }
  for (const [re, material] of PRINTED) {
    if (re.test(om)) return { material, why: `Onshape material ${om}` };
  }
  return undefined;
}

function processesFor(material: string, learned: Learned): { set: ProcessSet; why: string } | undefined {
  const team = learned.get(material);
  if (team && team.count >= 2) return { set: team, why: `as on ${team.count} other ${material} parts` };
  const set = DEFAULT_PROCESSES[material] ?? DEFAULT_PROCESSES[materialCategory(material) ?? ""];
  return set ? { set, why: "the team default" } : undefined;
}

const names = (s: ProcessSet) =>
  [s.preProcess, s.process1, s.process2]
    .filter(Boolean)
    .map((id) => getMachine(id!)?.name ?? id)
    .join(" → ");

// What the rules would set on a part, and why, or null when they can't tell.
export function suggestSetup(part: SetupInput, learned: Learned): { changes: SetupChanges; reason: string } | null {
  if (part.classification === "external") return null;
  const changes: SetupChanges = {};
  const why: string[] = [];

  let material = part.material;
  if (!material) {
    const guess = materialGuess(part);
    if (!guess) return null;
    material = guess.material;
    changes.material = material;
    why.push(`${guess.why}: ${material}`);
  }

  if (!part.preProcess && !part.process1 && !part.process2) {
    const p = processesFor(material, learned);
    if (p) {
      Object.assign(changes, { preProcess: p.set.preProcess ?? null, process1: p.set.process1 ?? null, process2: p.set.process2 ?? null });
      why.push(`${names(p.set)}, ${p.why}`);
      // Sync marks a part without processes as bought; a part we make is in-house.
      if (part.classification === "cots") changes.classification = "inhouse";
    }
  }

  if (!Object.keys(changes).length) return null;
  return { changes, reason: why.join(". ") + "." };
}

// Sorted extents in mm of a mesh in metres, smallest first.
export function sizeOf(positions: ArrayLike<number>): [number, number, number] | undefined {
  if (positions.length < 3) return undefined;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = positions[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  const mm = [0, 1, 2].map((a) => Math.round((max[a] - min[a]) * 1e5) / 100).sort((x, y) => x - y);
  return mm as [number, number, number];
}
