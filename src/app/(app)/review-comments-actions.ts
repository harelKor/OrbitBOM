"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { getMode } from "@/lib/mode";
import { addComment, approveComment, CommentError, deleteComment, rejectComment, saveSnipLines, tickComments, untickComment, type SnipInput } from "@/lib/reviews/comments";
import { isUuid } from "@/lib/uuid";

// CAD Review comments (src/lib/reviews/comments.ts checks who may do what).
export type CommentResult = { error?: string; id?: string };

async function run(fn: () => Promise<{ id?: string } | unknown>): Promise<CommentResult> {
  try {
    const r = await fn();
    revalidatePath("/robots", "layout");
    return { id: (r as { id?: string } | null)?.id };
  } catch (err) {
    if (err instanceof CommentError) return { error: err.message };
    throw err;
  }
}

// `systemId` null: a comment on the whole robot. `onshapeVersion`: from the Onshape panel, the
// version it was written on. `snip`: a picture cut from the 3D view, already uploaded.
export async function addReviewComment(
  robotId: string,
  systemId: string | null,
  body: string,
  part: { key: string; name: string | null } | null,
  onshapeVersion: { id: string; name: string } | null = null,
  snip: SnipInput | null = null,
): Promise<CommentResult> {
  const member = await requireMember();
  if (!isUuid(robotId) || (systemId !== null && !isUuid(systemId))) return { error: "Unknown system." };
  if (onshapeVersion && (!systemId || !/^[0-9a-f]{24}$/i.test(onshapeVersion.id) || typeof onshapeVersion.name !== "string")) return { error: "Unknown Onshape version." };
  return run(() =>
    addComment(member, { robotId, systemId, body, partKey: part?.key ?? null, partName: part?.name ?? null, onshapeVersion: onshapeVersion && { id: onshapeVersion.id.toLowerCase(), name: onshapeVersion.name }, snip }),
  );
}

// Lines drawn on a comment's snip (anyone; erasing others' lines is the author's alone).
export async function saveReviewSnip(id: string, own: unknown, keep: unknown): Promise<CommentResult> {
  const member = await requireMember();
  if (!isUuid(id)) return { error: "Unknown comment." };
  return run(() => saveSnipLines(member, id, { own, keep }));
}

export async function setReviewCommentDone(id: string, done: boolean): Promise<CommentResult> {
  const [member, mode] = await Promise.all([requireMember(), getMode()]);
  if (!isUuid(id)) return { error: "Unknown comment." };
  return run(() => (done ? tickComments(member, mode, null, [id]) : untickComment(member, mode, id)));
}

export async function approveReviewComment(id: string): Promise<CommentResult> {
  const [member, mode] = await Promise.all([requireMember(), getMode()]);
  if (!isUuid(id)) return { error: "Unknown comment." };
  return run(() => approveComment(member, mode, id));
}

export async function rejectReviewComment(id: string, note: string): Promise<CommentResult> {
  const [member, mode] = await Promise.all([requireMember(), getMode()]);
  if (!isUuid(id)) return { error: "Unknown comment." };
  return run(() => rejectComment(member, mode, id, note));
}

export async function deleteReviewComment(id: string): Promise<CommentResult> {
  const member = await requireMember();
  if (!isUuid(id)) return { error: "Unknown comment." };
  return run(() => deleteComment(member, id));
}
