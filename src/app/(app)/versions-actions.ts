"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { getMode, requireCapability } from "@/lib/mode";
import { tickComments } from "@/lib/reviews/comments";
import { OnshapeError } from "@/lib/onshape/client";
import { isUuid } from "@/lib/uuid";
import { commitDraft, VersionError } from "@/lib/versions/commit";
import { checkSystem, type Draft } from "@/lib/versions/detect";
import { pinModelToVersion, updateCad } from "@/lib/versions/cad";
import { releaseBomVersion } from "@/lib/versions/onshapeName";
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

// `rebuild`: the robot whose 3D model should be rebuilt now (Update 3D views was ticked).
export type CommitResult = { error?: string; message?: string; rebuild?: string };

// Commit changes: the draft the member reviewed becomes the system's next version. With `only`
// (a change's key), just that part is committed and the rest stay Outdated. `tick`: CAD Review
// comments ticked off in the window, done at the version committed. A whole commit also makes
// Onshape's "V<next> BOM release" version (onshapeName.ts); `note` is the site version's name and
// that version's description. `update3d` (Harel, 2026-11-11): the 3D views move to this version
// too; without it only the BOM and its export files do, which saves the 3D export's calls.
export async function commitChanges(systemId: string, draftId: string, seen: string, note: string, only?: string, tick: string[] = [], update3d = false): Promise<CommitResult> {
  const member = await requireCapability("sync");
  if (!isUuid(systemId) || !isUuid(draftId)) return { error: "Unknown system." };
  try {
    const name = note.trim().slice(0, 120);
    const c = await commitDraft(systemId, member.id, { draftId, seen, name, only });
    const ticked = await tickComments(member, await getMode(), systemId, tick.filter(isUuid), c.versionId);
    // Onshape failing never undoes the commit. A single part's commit makes no Onshape version.
    const named = only ? {} : await releaseBomVersion(systemId, c.versionId, name, member);
    const rebuild = update3d ? ((await pinModelToVersion(systemId, c.versionId)) ?? undefined) : undefined;
    revalidatePath("/robots", "layout");
    const label = named.label ?? c.label;
    const warning = (c.unknownMachines.length ? ` Unknown machines in Onshape: ${c.unknownMachines.join(", ")}.` : "") + (named.note ? ` ${named.note}` : "");
    const done = ticked ? ` ${ticked} ${ticked === 1 ? "comment" : "comments"} sent To check.` : "";
    if (only) return { message: `Committed to ${label}.${done}`, rebuild };
    return { message: `Committed as ${label}: ${c.added.length} added, ${c.updated} updated, ${c.removed.length} removed.${warning}${done}`, rebuild };
  } catch (err) {
    if (err instanceof VersionError) return { error: err.message };
    throw err;
  }
}

export type CadResult = { error?: string; message?: string; rebuild?: string; calls?: number };

// Update CAD (the Onshape panel's Update system window): this system's 3D moves to the
// assembly as it is now, as a new Onshape version or a sub-version (lib/versions/cad.ts).
export async function updateSystemCad(systemId: string, makeVersion: boolean, name = ""): Promise<CadResult> {
  const member = await requireCapability("sync");
  if (!isUuid(systemId)) return { error: "Unknown system." };
  if (!member.onshapeConnected) return { error: "Connect your Onshape account first (Profile → Connect Onshape)." };
  try {
    const r = await updateCad(systemId, member.id, { makeVersion, name });
    revalidatePath("/robots", "layout");
    return { message: r.unchanged ? `Nothing changed in Onshape since ${r.label}.` : `CAD updated as ${r.label}.`, rebuild: r.robotId, calls: r.calls };
  } catch (err) {
    if (err instanceof OnshapeError) return { error: err.message };
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
  return { message: "Shop Fab now shows the part's latest version." };
}
