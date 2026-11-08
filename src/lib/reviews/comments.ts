import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { can, type Mode } from "@/components/shell/mode";
import { db, schema } from "@/db";
import type { Member } from "@/lib/auth";

const { reviewComments, systems } = schema;

// CAD Review comments (plan/design-review.md; Harel, 2026-11-08): anyone signed in writes one; the
// CAD Team (and mentors) tick one off; a mentor approves it, or rejects it with a note, which opens
// it again. Server actions and the MCP tools both come through here.
export class CommentError extends Error {}

export const MAX_BODY = 2000;

export function canTick(mode: Mode, member: Pick<Member, "isMentor">) {
  return can(mode, "sync") || member.isMentor;
}

export async function addComment(member: Member, input: { systemId: string; body: string; partKey?: string | null; partName?: string | null }) {
  const body = input.body.trim();
  if (!body) throw new CommentError("Write the comment first.");
  if (body.length > MAX_BODY) throw new CommentError(`Keep a comment under ${MAX_BODY} characters.`);
  const [system] = await db.select({ id: systems.id }).from(systems).where(eq(systems.id, input.systemId));
  if (!system) throw new CommentError("That system is gone.");
  const [row] = await db
    .insert(reviewComments)
    .values({
      systemId: system.id,
      authorId: member.id,
      body,
      partKey: input.partKey?.slice(0, 300) || null,
      partName: input.partKey ? input.partName?.slice(0, 200) || null : null,
    })
    .returning();
  return row;
}

// Ticks off open comments of one system; `versionId`: the version the Update system window just
// committed. Returns how many were ticked.
export async function tickComments(member: Member, mode: Mode, systemId: string, ids: string[], versionId: string | null = null, tx: Pick<typeof db, "update"> = db) {
  if (!canTick(mode, member)) throw new CommentError("Only the CAD Team ticks comments off.");
  if (!ids.length) return 0;
  const rows = await tx
    .update(reviewComments)
    .set({ state: "done", doneAt: new Date(), doneBy: member.id, doneVersionId: versionId })
    .where(and(eq(reviewComments.systemId, systemId), inArray(reviewComments.id, ids), eq(reviewComments.state, "open")))
    .returning({ id: reviewComments.id });
  return rows.length;
}

async function commentOf(id: string) {
  const [row] = await db.select().from(reviewComments).where(eq(reviewComments.id, id));
  if (!row) throw new CommentError("That comment is gone.");
  return row;
}

const NOT_DONE = { doneAt: null, doneBy: null, doneVersionId: null } as const;

// A tick taken back before a mentor answered it.
export async function untickComment(member: Member, mode: Mode, id: string) {
  if (!canTick(mode, member)) throw new CommentError("Only the CAD Team ticks comments off.");
  const c = await commentOf(id);
  if (c.state !== "done") throw new CommentError(c.state === "approved" ? "A mentor already approved it." : "It isn't ticked.");
  await db.update(reviewComments).set({ state: "open", ...NOT_DONE }).where(and(eq(reviewComments.id, id), eq(reviewComments.state, "done")));
  return c;
}

export async function approveComment(member: Member, id: string) {
  if (!member.isMentor) throw new CommentError("Only mentors approve comments.");
  const c = await commentOf(id);
  if (c.state !== "done") throw new CommentError(c.state === "approved" ? "It's already approved." : "Only a ticked-off comment can be approved.");
  await db.update(reviewComments).set({ state: "approved", approvedAt: new Date(), approvedBy: member.id }).where(and(eq(reviewComments.id, id), eq(reviewComments.state, "done")));
  return c;
}

export async function rejectComment(member: Member, id: string, note: string) {
  if (!member.isMentor) throw new CommentError("Only mentors reject comments.");
  const why = note.trim();
  if (!why) throw new CommentError("Write why it isn't done yet.");
  const c = await commentOf(id);
  if (c.state !== "done") throw new CommentError("Only a ticked-off comment can be rejected.");
  await db
    .update(reviewComments)
    .set({ state: "open", ...NOT_DONE, rejectNote: why.slice(0, MAX_BODY), rejectedAt: new Date(), rejectedBy: member.id })
    .where(and(eq(reviewComments.id, id), eq(reviewComments.state, "done")));
  return c;
}

// Its author takes back an open comment; an admin removes any.
export async function deleteComment(member: Member, id: string) {
  const c = await commentOf(id);
  if (!member.isAdmin && (c.authorId !== member.id || c.state !== "open")) throw new CommentError("Only its author deletes an open comment.");
  await db.delete(reviewComments).where(eq(reviewComments.id, id));
  return c;
}

