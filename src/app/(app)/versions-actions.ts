"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { OnshapeError } from "@/lib/onshape/client";
import { isUuid } from "@/lib/uuid";
import { commitDraft, VersionError } from "@/lib/versions/commit";
import { checkSystem, type Draft } from "@/lib/versions/detect";

export type CheckResult = { draft?: Draft | null; error?: string; calls?: number; applied?: boolean };

// Update System (and the Onshape panel opening a system): checks the Manufacture assembly for
// changes and returns what is waiting to be committed. `quick` skips the BOM when the document
// didn't change since the last check.
export async function checkForChanges(systemId: string, quick = false): Promise<CheckResult> {
  const member = await requireMember();
  if (!isUuid(systemId)) return { error: "Unknown system." };
  if (!member.onshapeConnected) return { error: "Connect your Onshape account first (Profile → Connect Onshape)." };
  try {
    const r = await checkSystem(systemId, member.id, { force: !quick });
    if (!r.unchanged) revalidatePath("/robots", "layout");
    return { draft: r.draft, calls: r.calls, applied: r.applied };
  } catch (err) {
    if (err instanceof OnshapeError) return { error: err.message };
    throw err;
  }
}

export type CommitResult = { error?: string; message?: string };

// Commit changes: the draft the member reviewed becomes the system's next version. With `only`
// (a change's key), just that part is committed and the rest stay Outdated.
export async function commitChanges(systemId: string, draftId: string, seen: string, name: string, only?: string): Promise<CommitResult> {
  const member = await requireMember();
  if (!isUuid(systemId) || !isUuid(draftId)) return { error: "Unknown system." };
  try {
    const c = await commitDraft(systemId, member.id, { draftId, seen, name: name.slice(0, 120), only });
    revalidatePath("/robots", "layout");
    const warning = c.unknownMachines.length ? ` Unknown machines in Onshape: ${c.unknownMachines.join(", ")}.` : "";
    if (only) return { message: `Committed to ${c.label}.` };
    return { message: `Committed as ${c.label}: ${c.added.length} added, ${c.updated} updated, ${c.removed.length} removed.${warning}` };
  } catch (err) {
    if (err instanceof VersionError) return { error: err.message };
    throw err;
  }
}
