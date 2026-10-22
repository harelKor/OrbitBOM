"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { applyEachPartChanges } from "@/lib/parts/apply";
import { partChangesSchema, type PartChanges } from "@/lib/parts/changes";
import { isUuid } from "@/lib/uuid";
import type { ActionResult } from "../parts-actions";

// The COTS page's edits: a card that stands for the same part in several systems changes each of
// them (its stock count spread over them), all in one history batch.
export async function updateCotsParts(edits: { id: string; changes: unknown }[]): Promise<ActionResult> {
  const member = await requireMember();
  if (!edits.length || edits.some((e) => !isUuid(e.id))) return { error: "Unknown part." };
  const parsed: { id: string; changes: PartChanges }[] = [];
  for (const e of edits) {
    const r = partChangesSchema.safeParse(e.changes);
    if (!r.success) return { error: r.error.issues[0].message };
    parsed.push({ id: e.id, changes: r.data });
  }
  await applyEachPartChanges(parsed, { memberId: member.id, via: "ui" });
  revalidatePath("/cots", "layout");
  revalidatePath("/robots", "layout");
  return {};
}
