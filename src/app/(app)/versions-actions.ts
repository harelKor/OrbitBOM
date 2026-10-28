"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/mode";
import { OnshapeError } from "@/lib/onshape/client";
import { isUuid } from "@/lib/uuid";
import { commitDraft, VersionError } from "@/lib/versions/commit";
import { checkSystem, type Draft } from "@/lib/versions/detect";
import { revertSystem, updatePartToLatest } from "@/lib/versions/history";

export type CheckResult = { draft?: Draft | null; error?: string; calls?: number; applied?: boolean };

// Update System (and the Onshape panel opening a system): checks the Manufacture assembly for
// changes and returns what is waiting to be committed. `quick` skips the BOM when the document
// didn't change since the last check.
export async function checkForChanges(systemId: string, quick = false): Promise<CheckResult> {
  const member = await requireCapability("sync");
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
  const member = await requireCapability("sync");
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

// Revert: the system's parts go back to their state in a version (Onshape isn't touched).
export async function revertToVersion(systemId: string, versionId: string): Promise<CommitResult> {
  const member = await requireCapability("sync");
  if (!isUuid(systemId) || !isUuid(versionId)) return { error: "Unknown version." };
  try {
    const r = await revertSystem(systemId, versionId, member.id);
    revalidatePath("/robots", "layout");
    return { message: `Reverted to ${r.label}: ${r.moved} ${r.moved === 1 ? "part" : "parts"} changed.` };
  } catch (err) {
    if (err instanceof VersionError) return { error: err.message };
    throw err;
  }
}

// An Outdated part's Update after a Revert: it takes its newest committed state.
export async function updateToLatest(systemId: string, partId: string): Promise<CommitResult> {
  const member = await requireCapability("sync");
  if (!isUuid(systemId) || !isUuid(partId)) return { error: "Unknown part." };
  try {
    await updatePartToLatest(systemId, partId, member.id);
    revalidatePath("/robots", "layout");
    return { message: "Updated." };
  } catch (err) {
    if (err instanceof VersionError) return { error: err.message };
    throw err;
  }
}
