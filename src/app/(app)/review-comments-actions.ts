"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/auth";
import { getMode } from "@/lib/mode";
import { addComment, approveComment, CommentError, deleteComment, rejectComment, tickComments, untickComment } from "@/lib/reviews/comments";
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

// `systemId` null: a comment on the whole robot.
export async function addReviewComment(robotId: string, systemId: string | null, body: string, part: { key: string; name: string | null } | null): Promise<CommentResult> {
  const member = await requireMember();
  if (!isUuid(robotId) || (systemId !== null && !isUuid(systemId))) return { error: "Unknown system." };
  return run(() => addComment(member, { robotId, systemId, body, partKey: part?.key ?? null, partName: part?.name ?? null }));
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
