"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { requireCapability } from "@/lib/mode";
import { OnshapeError } from "@/lib/onshape/client";
import { isUuid } from "@/lib/uuid";
import { commitDraft, VersionError } from "@/lib/versions/commit";
import { checkSystem, type Draft } from "@/lib/versions/detect";
import { syncOnshapeVersionName } from "@/lib/versions/onshapeName";
import { listPartVersions, revertSystem, updatePartToLatest, type PartVersionEntry } from "@/lib/versions/history";
import { relockPart } from "@/lib/versions/release";

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
    // The same name in Onshape's version tree; Onshape failing never undoes the commit.
    const named = await syncOnshapeVersionName(systemId, c.versionId, name.slice(0, 120), member);
    revalidatePath("/robots", "layout");
    const label = named.label ?? c.label;
    const warning = (c.unknownMachines.length ? ` Unknown machines in Onshape: ${c.unknownMachines.join(", ")}.` : "") + (named.note ? ` ${named.note}` : "");
    if (only) return { message: `Committed to ${label}.${named.note ? ` ${named.note}` : ""}` };
    return { message: `Committed as ${label}: ${c.added.length} added, ${c.updated} updated, ${c.removed.length} removed.${warning}` };
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

// The part window's Versions button: the versions that changed this part, with its releases.
export async function partVersionHistory(partId: string): Promise<{ systemId?: string | null; entries?: PartVersionEntry[]; error?: string }> {
  await requireMember();
  if (!isUuid(partId)) return { error: "Unknown part." };
  return listPartVersions(partId);
}

// "Update fab version": To Fab takes the part's latest committed state, its status unchanged.
export async function updateFabVersion(partId: string): Promise<CommitResult> {
  const member = await requireCapability("sync");
  if (!isUuid(partId)) return { error: "Unknown part." };
  if (!(await relockPart(partId, member.id))) return { error: "That part is gone." };
  revalidatePath("/robots", "layout");
  return { message: "To Fab now shows the part's latest version." };
}
