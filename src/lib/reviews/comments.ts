import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { can, type Mode } from "@/components/shell/mode";
import { db, schema } from "@/db";
import type { ModelKind } from "@/db/schema";
import type { Member } from "@/lib/auth";
import { cleanView, type ViewState } from "@/components/viewer/viewState";
import { deleteObject } from "@/lib/storage/r2";
import { cleanStrokes, mergeStrokes } from "./snipStrokes";
import { allowedStatuses, COMMENT_STATUSES, needsNote, type CommentStatus } from "./status";

// A snip as the browser sends it: its picture already uploaded (/api/review-snips), its lines.
export type SnipInput = { path: string; w: number; h: number; strokes: unknown };
const SNIP_PATH = /^review-snips\/[0-9a-f-]{36}\.(jpg|png)$/;

const { reviewComments, systems } = schema;

// CAD Review comments (plan/design-review.md; Harel, 2026-11-08): anyone signed in writes one; its
// status goes Open → On it → To check → Done (status.ts, Harel 2026-11-13). Server actions and the
// MCP tools both come through here.
export class CommentError extends Error {}

export const MAX_BODY = 2000;

export function canTick(mode: Mode, member: Pick<Member, "isMentor">) {
  return can(mode, "sync") || member.isMentor;
}

// Mentors approve and reject; so does an admin in Edit mode (Harel, 2026-11-08).
export function canApprove(mode: Mode, member: Pick<Member, "isMentor">) {
  return mode === "edit" || member.isMentor;
}

// A comment on a system, or with `systemId` null on the whole robot (Harel, 2026-11-09).
// `onshapeVersion`: the Onshape version it was written on, from the Onshape panel. `snip`: a
// picture cut from the 3D view (already uploaded) with its lines. `view`: the 3D view it was
// written in (viewState.ts), `pin`: the newest pick's point there, assembly mm (S6).
export async function addComment(
  member: Member,
  input: { robotId?: string; systemId: string | null; body: string; partKey?: string | null; partName?: string | null; onshapeVersion?: { id: string; name: string } | null; snip?: SnipInput | null; view?: unknown; pin?: unknown; model?: ModelKind },
) {
  const body = input.body.trim();
  if (!body) throw new CommentError("Write the comment first.");
  if (body.length > MAX_BODY) throw new CommentError(`Keep a comment under ${MAX_BODY} characters.`);
  let robotId = input.robotId ?? null;
  if (input.systemId) {
    const [system] = await db.select({ id: systems.id, robotId: systems.robotId }).from(systems).where(eq(systems.id, input.systemId));
    if (!system || (robotId && system.robotId !== robotId)) throw new CommentError("That system is gone.");
    robotId = system.robotId;
  } else {
    const [robot] = robotId ? await db.select({ id: schema.robots.id }).from(schema.robots).where(eq(schema.robots.id, robotId)) : [];
    if (!robot) throw new CommentError("That robot is gone.");
  }
  let snip = null;
  if (input.snip) {
    const { path, strokes } = input.snip;
    const w = Math.round(Number(input.snip.w));
    const h = Math.round(Number(input.snip.h));
    if (!SNIP_PATH.test(path) || !(w > 0 && w <= 8000 && h > 0 && h <= 8000)) throw new CommentError("That snip didn't upload. Take it again.");
    snip = { path, w, h, strokes: cleanStrokes(strokes, w, h).map((s) => ({ ...s, by: member.id })), changed: [] };
  }
  const [row] = await db
    .insert(reviewComments)
    .values({
      robotId: robotId!,
      systemId: input.systemId,
      authorId: member.id,
      body,
      partKey: input.partKey?.slice(0, 300) || null,
      partName: input.partKey ? input.partName?.slice(0, 200) || null : null,
      onshapeVersionId: input.onshapeVersion?.id ?? null,
      onshapeVersionName: input.onshapeVersion ? input.onshapeVersion.name.slice(0, 200) : null,
      snip,
      view: input.view ? cleanView(input.view) : null,
      pin: cleanPin(input.pin),
      model: input.model === "basepart" ? "basepart" : "final",
    })
    .returning();
  return row;
}

// A pin: three finite numbers, assembly mm, within 100 m of the origin.
export function cleanPin(x: unknown): [number, number, number] | null {
  if (!Array.isArray(x) || x.length !== 3 || !x.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 1e5)) return null;
  return x.map((n) => Math.round(n * 100) / 100) as [number, number, number];
}

export type { ViewState };

// Lines drawn on a comment's snip: `own` are the saver's lines as they now are; `keep` (its
// author only) the other members' lines they didn't erase, by position (snipStrokes.ts).
export async function saveSnipLines(member: Member, id: string, sent: { own: unknown; keep?: unknown }) {
  const c = await commentOf(id);
  if (!c.snip) throw new CommentError("That comment has no snip.");
  const own = cleanStrokes(sent.own, c.snip.w, c.snip.h);
  const keep = Array.isArray(sent.keep) ? sent.keep.map(Number) : [];
  const snip = mergeStrokes(c.snip, member, c.authorId === member.id, { own, keep });
  await db.update(reviewComments).set({ snip }).where(eq(reviewComments.id, id));
  return c;
}

// The Update system window's ticks: comments still to act on (of one system, when `systemId` is
// given) go To check, with `versionId`, the version it just committed. Returns how many.
export async function tickComments(member: Member, mode: Mode, systemId: string | null, ids: string[], versionId: string | null = null, tx: Pick<typeof db, "update"> = db) {
  if (!canTick(mode, member)) throw new CommentError("Only the CAD Team ticks comments off.");
  if (!ids.length) return 0;
  const rows = await tx
    .update(reviewComments)
    .set({ state: "to_check", doneAt: new Date(), doneBy: member.id, doneVersionId: versionId })
    .where(and(systemId ? eq(reviewComments.systemId, systemId) : undefined, inArray(reviewComments.id, ids), inArray(reviewComments.state, ["open", "on_it"])))
    .returning({ id: reviewComments.id });
  return rows.length;
}

async function commentOf(id: string) {
  const [row] = await db.select().from(reviewComments).where(eq(reviewComments.id, id));
  if (!row) throw new CommentError("That comment is gone.");
  return row;
}

// Sets a comment's status (rules in status.ts). Each status keeps who set it and when; going back
// clears what came after it. A mentor sending a To check one back writes `note`, kept as the
// last rejection.
export async function setCommentStatus(member: Member, mode: Mode, id: string, to: CommentStatus, note = "") {
  if (!COMMENT_STATUSES.some((s) => s.key === to)) throw new CommentError("Unknown status.");
  const c = await commentOf(id);
  if (c.state === to) return c;
  const who = { team: canTick(mode, member), approver: canApprove(mode, member), author: c.authorId === member.id };
  if (!allowedStatuses(c.state, who).includes(to))
    throw new CommentError(to === "done" || c.state === "done" ? "Only a mentor sets a comment Done or takes it back." : "Only the CAD Team or its author changes a comment's status.");
  const why = note.trim();
  if (needsNote(c.state, to, { mentor: member.isMentor }) && !why) throw new CommentError("Write why it isn't done yet.");
  const now = new Date();
  const order = ["open", "on_it", "to_check", "done"];
  const back = order.indexOf(to) < order.indexOf(c.state);
  const set: Partial<typeof reviewComments.$inferInsert> = { state: to };
  if (to === "on_it") Object.assign(set, { onItAt: now, onItBy: member.id });
  if (to === "to_check") Object.assign(set, { doneAt: now, doneBy: member.id, doneVersionId: null });
  if (to === "done") Object.assign(set, { approvedAt: now, approvedBy: member.id });
  if (back) {
    Object.assign(set, { approvedAt: null, approvedBy: null });
    if (to !== "to_check") Object.assign(set, { doneAt: null, doneBy: null, doneVersionId: null });
    if (to === "open") Object.assign(set, { onItAt: null, onItBy: null });
  }
  if (why) Object.assign(set, { rejectNote: why.slice(0, MAX_BODY), rejectedAt: now, rejectedBy: member.id });
  // Only if nobody changed it meanwhile.
  const rows = await db.update(reviewComments).set(set).where(and(eq(reviewComments.id, id), eq(reviewComments.state, c.state))).returning({ id: reviewComments.id });
  if (!rows.length) throw new CommentError("Someone changed it just now. Look again.");
  return c;
}

// Its author takes back an open comment; an admin removes any.
export async function deleteComment(member: Member, id: string) {
  const c = await commentOf(id);
  if (!member.isAdmin && (c.authorId !== member.id || c.state !== "open")) throw new CommentError("Only its author deletes an Open comment.");
  await db.delete(reviewComments).where(eq(reviewComments.id, id));
  if (c.snip) await deleteObject(c.snip.path).catch(() => {});
  return c;
}

