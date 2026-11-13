import "server-only";
import { GeminiError, geminiJson } from "@/lib/recognize/gemini";
import type { AiReview, CheckLimits, CheckResults } from "./types";

// Phase 7 of the Design check (Harel's list, 2026-11-13): Google's free Gemini (the key Scan
// uses; no billing account, so it can't cost anything) explains what the geometry code measured.
// It never measures: it gets the numbers and names, no pictures, and answers in JSON.
// On the free tier Google may use what's sent to improve its products; the panel says so.

export class AiError extends Error {}

function why(err: unknown): never {
  if (err instanceof GeminiError) {
    if (err.code === "unset") throw new AiError("The AI isn't set up: the server has no GEMINI_API_KEY.");
    if (err.code === "quota") throw new AiError("The free AI quota is used up for now. Try again later.");
    if (err.code === "busy") throw new AiError("Google's free AI is busy. Try again in a minute.");
    throw new AiError(err.message);
  }
  throw err;
}

// The stress test's loads: which holes bolt the plate down and what pushes on it, guessed from
// what the plate is and where its holes are.
export type LoadInput = { name: string; system: string | null; material: string; t: number; size: [number, number]; holes: { i: number; x: number; y: number; d: number }[] };
export type LoadGuess = { held: number[]; load: { hole: number; N: number; deg: number }; why: string };

const LOAD_SCHEMA = {
  type: "OBJECT",
  properties: {
    held: { type: "ARRAY", items: { type: "INTEGER" } },
    loadHole: { type: "INTEGER" },
    newtons: { type: "NUMBER" },
    degrees: { type: "NUMBER" },
    why: { type: "STRING" },
  },
  required: ["held", "loadHole", "newtons", "degrees", "why"],
};

export async function suggestLoads(input: LoadInput): Promise<LoadGuess> {
  const text = `You help a FIRST Robotics Competition team check a flat plate on their robot.
Plate: "${input.name}"${input.system ? ` in the "${input.system}" system` : ""}, ${input.material}, ${input.t.toFixed(1)} mm thick, ${input.size[0].toFixed(0)} × ${input.size[1].toFixed(0)} mm.
Its round holes, in the plate's own 2D frame (mm, x right, y up): ${input.holes.map((h) => `#${h.i} at (${h.x.toFixed(0)}, ${h.y.toFixed(0)}) Ø${h.d.toFixed(1)}`).join("; ")}.
Guess how it is used: which holes are bolted to the rest of the robot (usually small bolt holes in groups near the edges, typically Ø4–7 mm), and which one hole carries the main working load (often a bearing bore, a shaft or a pivot, larger than bolt holes).
Give a realistic worst-case in-plane force for an FRC robot (a chain or belt pull, an arm or elevator load, a hit from another robot), in newtons, and its direction as an angle in degrees in the same frame (0 = +x, 90 = +y).
"held" lists hole numbers; "loadHole" one hole number not in "held"; "why" is one or two plain sentences for a student: what you think the plate does and where the load comes from.`;
  try {
    const { value } = await geminiJson<{ held: number[]; loadHole: number; newtons: number; degrees: number; why: string }>([{ text }], LOAD_SCHEMA, "low");
    const ids = new Set(input.holes.map((h) => h.i));
    const held = [...new Set(value.held)].filter((i) => ids.has(i) && i !== value.loadHole);
    if (!ids.has(value.loadHole) || !held.length) throw new AiError("The AI's guess didn't fit this plate. Pick the holes yourself.");
    const N = Math.min(20000, Math.max(10, Number(value.newtons) || 500));
    return { held, load: { hole: value.loadHole, N, deg: Math.round(Number(value.degrees) || 0) }, why: String(value.why ?? "").slice(0, 600) };
  } catch (err) {
    if (err instanceof AiError) throw err;
    why(err);
  }
}

// The whole run in plain words for a review: a short summary for the mentors and a likely fix
// for each finding (by its id: a finding's id, or "clash:<a>|<b>" for an overlap).

const REVIEW_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING" },
    fixes: { type: "ARRAY", items: { type: "OBJECT", properties: { id: { type: "STRING" }, fix: { type: "STRING" } }, required: ["id", "fix"] } },
  },
  required: ["summary", "fixes"],
};

export async function reviewRun(robot: string, limits: CheckLimits, r: CheckResults, systems: Record<string, string>): Promise<AiReview> {
  const kg = (g: number) => (g / 1000).toFixed(1);
  const items = [
    ...r.clashes.filter((c) => !c.expected).slice(0, 30).map((c) => ({ id: `clash:${c.a}|${c.b}`, text: `${c.aName} and ${c.bName} overlap${c.depthMm >= 0.1 ? ` by about ${c.depthMm.toFixed(1)} mm` : ""}${c.copies > 1 ? ` (${c.copies} places)` : ""}.` })),
    ...(r.findings ?? []).slice(0, 60).map((f) => ({ id: f.id, text: `[${f.kind}${f.level === "warn" ? "" : ", minor"}] ${f.text}${f.copies > 1 ? ` (${f.copies} places)` : ""}` })),
  ];
  const sys = r.weight.bySystem.map((s) => `${s.systemId ? (systems[s.systemId] ?? "a system") : "no system"} ${kg(s.g)} kg${s.systemId && limits.budgets?.[s.systemId] ? ` (budget ${limits.budgets[s.systemId]} kg)` : ""}`).join(", ");
  const env = r.envelope;
  const text = `You are a senior mentor reviewing a FIRST Robotics Competition robot's CAD ("${robot}") from an automatic design check. The numbers below were measured from the 3D model; trust them, don't invent others.
Weight: ${kg(r.weight.totalG)} kg${limits.weightKg ? ` (limit ${limits.weightKg} kg)` : ""}. By system: ${sys}.
${env ? `Frame perimeter ${env.perimeterMm.toFixed(0)} mm${limits.perimeterMm ? ` (limit ${limits.perimeterMm})` : ""}, frame ${env.lengthMm.toFixed(0)} × ${env.widthMm.toFixed(0)} mm, height ${env.heightMm.toFixed(0)} mm${limits.heightMm ? ` (limit ${limits.heightMm})` : ""}${env.out.length ? `; ${env.out.length} parts reach past the frame perimeter, the most ${env.out[0].name} by ${env.out[0].mm} mm` : ""}.` : ""}
Findings:
${items.map((i) => `- (${i.id}) ${i.text}`).join("\n") || "- none"}
Write "summary": 3 to 6 short plain sentences for the team: what matters most first (weight or size over a limit, real overlaps, unattached parts, weak spots), what can wait. No headings, no lists, no praise.
Write "fixes": for each finding id above, one short sentence with the most likely fix in CAD or in the shop (use the id exactly as given). Skip ones that are probably fine.`;
  try {
    const { value, model } = await geminiJson<{ summary: string; fixes: { id: string; fix: string }[] }>([{ text }], REVIEW_SCHEMA, "high");
    const known = new Set(items.map((i) => i.id));
    const fixes: Record<string, string> = {};
    for (const f of value.fixes ?? []) if (known.has(f.id) && f.fix) fixes[f.id] = String(f.fix).slice(0, 400);
    return { summary: String(value.summary ?? "").slice(0, 2000), fixes, model, at: new Date().toISOString() };
  } catch (err) {
    why(err);
  }
}
