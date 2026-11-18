import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Member } from "@/lib/auth";
import { createRobotVersion } from "@/lib/versions/robotVersions";
import { VersionError } from "@/lib/versions/commit";
import { CommentError } from "./comments";

const { designReviews, members, reviewComments, robotVersions, systems } = schema;

// Design Reviews (plan/cad-design-review.md, Harel 2026-11-18). An admin starts one on a robot (the
// whole robot or some of its systems) with a State text, tagged with the robot's newest version (none
// is made); comments written while it's open and in its scope join it; Finish may make a robot
// version for it. One open per robot (a unique index). Server actions and MCP tools come here.

export const MAX_STATE = 2000;

export type DesignReview = {
  id: string;
  seq: number;
  name: string; // "DR 3"
  wholeRobot: boolean;
  systems: { id: string; name: string }[];
  state: string;
  version: string | null; // the robot version at Start: "R7"
  finishVersion: string | null; // made at Finish
  startedBy: string | null;
  startedAt: string;
  finishedBy: string | null;
  finishedAt: string | null;
  open: boolean;
};

export const reviewName = (seq: number) => `DR ${seq}`;

export async function listDesignReviews(robotId: string): Promise<DesignReview[]> {
  const rows = await db.select().from(designReviews).where(eq(designReviews.robotId, robotId)).orderBy(desc(designReviews.seq));
  if (!rows.length) return [];
  const sysIds = [...new Set(rows.flatMap((r) => r.systemIds))];
  const peopleIds = [...new Set(rows.flatMap((r) => [r.startedBy, r.finishedBy]).filter((x): x is string => !!x))];
  const [sys, people] = await Promise.all([
    sysIds.length ? db.select({ id: systems.id, name: systems.name }).from(systems).where(inArray(systems.id, sysIds)) : [],
    peopleIds.length ? db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, peopleIds)) : [],
  ]);
  const sysName = new Map(sys.map((s) => [s.id, s.name]));
  const who = new Map(people.map((p) => [p.id, p.name]));
  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    name: reviewName(r.seq),
    wholeRobot: r.wholeRobot,
    systems: r.wholeRobot ? [] : r.systemIds.filter((id) => sysName.has(id)).map((id) => ({ id, name: sysName.get(id)! })),
    state: r.state,
    version: r.versionLabel,
    finishVersion: r.finishVersionLabel,
    startedBy: r.startedBy ? (who.get(r.startedBy) ?? null) : null,
    startedAt: r.startedAt.toISOString(),
    finishedBy: r.finishedBy ? (who.get(r.finishedBy) ?? null) : null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    open: !r.finishedAt,
  }));
}

function mustBeAdmin(member: Member) {
  if (!member.isAdmin) throw new CommentError("Only an admin starts or finishes a Design Review.");
}

// Start: the robot's newest robot version is the DR's (Harel, 2026-11-18: none is made here).
export async function startDesignReview(member: Member, robotId: string, input: { wholeRobot: boolean; systemIds?: string[]; state: string }) {
  mustBeAdmin(member);
  const state = input.state.trim();
  if (!state) throw new CommentError("Write the state of what's being reviewed.");
  if (state.length > MAX_STATE) throw new CommentError(`Keep the state under ${MAX_STATE} characters.`);
  const [robot] = await db.select({ id: schema.robots.id }).from(schema.robots).where(eq(schema.robots.id, robotId));
  if (!robot) throw new CommentError("That robot is gone.");
  let systemIds: string[] = [];
  if (!input.wholeRobot) {
    const asked = [...new Set(input.systemIds ?? [])];
    const found = asked.length ? await db.select({ id: systems.id }).from(systems).where(and(eq(systems.robotId, robotId), inArray(systems.id, asked))) : [];
    if (!found.length) throw new CommentError("Choose the systems being reviewed, or the whole robot.");
    systemIds = found.map((s) => s.id);
  }
  const [version] = await db.select({ id: robotVersions.id, name: robotVersions.name }).from(robotVersions).where(eq(robotVersions.robotId, robotId)).orderBy(desc(robotVersions.seq)).limit(1);
  try {
    return await db.transaction(async (tx) => {
      const [last] = await tx.select({ seq: designReviews.seq }).from(designReviews).where(eq(designReviews.robotId, robotId)).orderBy(desc(designReviews.seq)).limit(1).for("update");
      const [row] = await tx
        .insert(designReviews)
        .values({ robotId, seq: (last?.seq ?? 0) + 1, wholeRobot: input.wholeRobot, systemIds, state, robotVersionId: version?.id ?? null, versionLabel: version?.name ?? null, startedBy: member.id })
        .returning();
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new CommentError("A Design Review is already open on this robot.");
    throw err;
  }
}

function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { code?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) if (e.code === "23505") return true;
  return false;
}

export async function openDesignReview(robotId: string) {
  const [row] = await db.select().from(designReviews).where(and(eq(designReviews.robotId, robotId), isNull(designReviews.finishedAt)));
  return row ?? null;
}

// Finish: with `version`, a robot version is made for it first (Create version's rules: no Onshape
// calls; refused when no system's 3D model is on a fixed version yet), kept as its finish version.
export async function finishDesignReview(member: Member, robotId: string, opts: { version?: string | null } = {}) {
  mustBeAdmin(member);
  const dr = await openDesignReview(robotId);
  if (!dr) throw new CommentError("No Design Review is open on this robot.");
  let made: { id: string; name: string } | null = null;
  if (opts.version != null) {
    try {
      const v = await createRobotVersion(robotId, member.id, opts.version, dr.state);
      made = { id: v.id, name: v.name };
    } catch (err) {
      if (err instanceof VersionError) throw new CommentError(err.message);
      throw err;
    }
  }
  const [row] = await db
    .update(designReviews)
    .set({ finishedAt: new Date(), finishedBy: member.id, ...(made && { finishVersionId: made.id, finishVersionLabel: made.name }) })
    .where(and(eq(designReviews.id, dr.id), isNull(designReviews.finishedAt)))
    .returning();
  if (!row) throw new CommentError("Someone finished it just now.");
  return row;
}

// The open DR a new comment joins: a whole-robot one takes every comment; one on some systems takes
// comments on those systems and on the whole robot (Harel, 2026-11-18).
export async function reviewForNewComment(robotId: string, systemId: string | null) {
  const dr = await openDesignReview(robotId);
  if (!dr) return null;
  return dr.wholeRobot || !systemId || dr.systemIds.includes(systemId) ? dr.id : null;
}

// ⋮ Add to DR… / Remove from DR: the comment's author or an admin.
export async function setCommentReview(member: Member, commentId: string, reviewId: string | null) {
  const [c] = await db.select({ robotId: reviewComments.robotId, authorId: reviewComments.authorId }).from(reviewComments).where(eq(reviewComments.id, commentId));
  if (!c) throw new CommentError("That comment is gone.");
  if (!member.isAdmin && c.authorId !== member.id) throw new CommentError("Only its author or an admin moves a comment into a Design Review.");
  if (reviewId) {
    const [dr] = await db.select({ robotId: designReviews.robotId }).from(designReviews).where(eq(designReviews.id, reviewId));
    if (!dr || dr.robotId !== c.robotId) throw new CommentError("That Design Review isn't on this comment's robot.");
  }
  await db.update(reviewComments).set({ designReviewId: reviewId }).where(eq(reviewComments.id, commentId));
  return c;
}
