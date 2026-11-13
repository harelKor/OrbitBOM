"use server";

import { requireCapability } from "@/lib/mode";
import { saveCheck, setIgnored, setLimits, setPartWeight } from "@/lib/check/store";
import type { CheckLimits, CheckResults } from "@/lib/check/types";
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
