"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { redoBatch, revertSystemUpdate, revertVisit, undoLatest } from "@/lib/actions/revert";
import { isUuid } from "@/lib/uuid";
import { VersionError } from "@/lib/versions/commit";

export type ActionResult = { message?: string; error?: string; batchId?: string | null; undone?: string | null; systemId?: string };

// Revert on a Recent actions box: a page visit's part edits, or a System Update.
export async function revertAction(kind: "edit" | "system", id: string): Promise<ActionResult> {
  const member = await requireMember();
  if (!isUuid(id)) return { error: "Unknown action." };
  try {
    const r = kind === "system" ? await revertSystemUpdate(id, member.id) : await revertVisit(id, member.id);
    revalidatePath("/robots", "layout");
    return r;
  } catch (err) {
    if (err instanceof VersionError) return { error: err.message };
    throw err;
  }
}

// Undo (Ctrl+Z): this member's newest part edit that this tab hasn't undone yet.
export async function undoAction(exclude: string[]): Promise<ActionResult> {
  const member = await requireMember();
  const r = await undoLatest(member.id, exclude.filter(isUuid).slice(-200));
  if (r.batchId) revalidatePath("/robots", "layout");
  return r;
}

// Redo (Ctrl+Shift+Z): undoes an undo.
export async function redoAction(batchId: string): Promise<ActionResult> {
  const member = await requireMember();
  if (!isUuid(batchId)) return { error: "Nothing to redo." };
  const r = await redoBatch(batchId, member.id);
  if (r.batchId) revalidatePath("/robots", "layout");
  return r;
}
