"use server";

import { requireCapability } from "@/lib/mode";
import { AiError, reviewRun, suggestLoads, type LoadGuess, type LoadInput } from "@/lib/check/ai";
import { latestRun, saveCheck, saveReview, setIgnored, setIgnoredId, setLimits, setPartWeight } from "@/lib/check/store";
import type { AiReview, CheckLimits, CheckResults } from "@/lib/check/types";
import { isUuid } from "@/lib/uuid";

// Design check (plan/design-check.md): the run happens in the CAD member's browser; these save
// what it found and what the team set. No revalidatePath: the CAD page reads checks through its
// own GET (src/app/api/robots/<id>/design-check), so nothing else needs to render again.
export type CheckActionResult = { error?: string };

const MAX_RESULTS = 2_000_000; // characters of JSON: far above a real robot's run

function looksLikeResults(r: unknown): r is CheckResults {
  const o = r as CheckResults | null;
  return !!o && o.v === 1 && !!o.weight && Array.isArray(o.weight.parts) && Array.isArray(o.clashes) && typeof o.ms === "number";
}

export async function saveDesignCheck(robotId: string, model: "final" | "basepart", sig: string, results: CheckResults): Promise<CheckActionResult> {
  const member = await requireCapability("check");
  if (!isUuid(robotId) || (model !== "final" && model !== "basepart") || typeof sig !== "string" || sig.length > 200) return { error: "Not a robot." };
  if (!looksLikeResults(results) || JSON.stringify(results).length > MAX_RESULTS) return { error: "The check's results didn't come through. Run it again." };
  await saveCheck(robotId, model, sig, results, member.id);
  return {};
}

export async function saveCheckLimits(robotId: string, limits: CheckLimits): Promise<CheckActionResult & { limits?: CheckLimits }> {
  await requireCapability("manage");
  if (!isUuid(robotId)) return { error: "Not a robot." };
  return { limits: await setLimits(robotId, limits) };
}

// A part's real weight in grams (one copy); null goes back to the estimate from its material.
export async function savePartWeight(key: string, grams: number | null): Promise<CheckActionResult> {
  const member = await requireCapability("check");
  if (typeof key !== "string" || !key || key.length > 300) return { error: "Not a part." };
  if (grams != null && !(Number.isFinite(grams) && grams > 0 && grams < 1_000_000)) return { error: "Type the weight in grams." };
  await setPartWeight(key, grams == null ? null : Math.round(grams * 10) / 10, member.id);
  return {};
}

export async function setOverlapIgnored(robotId: string, a: string, b: string, ignored: boolean): Promise<CheckActionResult> {
  const member = await requireCapability("check");
  if (!isUuid(robotId) || typeof a !== "string" || typeof b !== "string" || !a || !b || a.length > 300 || b.length > 300) return { error: "Not a part." };
  await setIgnored(robotId, a, b, ignored, member.id);
  return {};
}

// A finding (connections, access, plates, printed parts) marked fine: not listed again.
export async function setFindingIgnored(robotId: string, id: string, ignored: boolean): Promise<CheckActionResult> {
  const member = await requireCapability("check");
  if (!isUuid(robotId) || typeof id !== "string" || !id || id.length > 1000) return { error: "Not a finding." };
  await setIgnoredId(robotId, id, ignored, member.id);
  return {};
}

// Phase 7: the AI's guess of a plate's loads for the stress test (Gemini's free tier).
export async function aiSuggestLoads(input: LoadInput): Promise<CheckActionResult & { guess?: LoadGuess }> {
  await requireCapability("check");
  const ok = input && typeof input.name === "string" && Array.isArray(input.holes) && input.holes.length > 1 && input.holes.length <= 200 && Number.isFinite(input.t);
  if (!ok) return { error: "Pick a plate with at least two round holes." };
  try {
    return { guess: await suggestLoads({ ...input, name: input.name.slice(0, 200), system: input.system?.slice(0, 200) ?? null, material: String(input.material).slice(0, 100) }) };
  } catch (err) {
    if (err instanceof AiError) return { error: err.message };
    throw err;
  }
}

// Phase 7: the newest run written up by the AI, saved with it.
export async function aiReviewCheck(robotId: string, model: "final" | "basepart"): Promise<CheckActionResult & { ai?: AiReview }> {
  await requireCapability("check");
  if (!isUuid(robotId) || (model !== "final" && model !== "basepart")) return { error: "Not a robot." };
  const last = await latestRun(robotId, model);
  if (!last) return { error: "Run the check first." };
  try {
    const ai = await reviewRun(last.robot, last.limits, last.run.results, last.systems);
    await saveReview(last.run.id, { ...last.run.results, ai });
    return { ai };
  } catch (err) {
    if (err instanceof AiError) return { error: err.message };
    throw err;
  }
}
