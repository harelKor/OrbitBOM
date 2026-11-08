import "server-only";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ReviewRef } from "@/db/schema";

const { designReviews, reviewRounds, members, robots, systems } = schema;

export type ReviewRound = {
  id: string;
  seq: number;
  state: "building" | "ready";
  note: string | null;
  error: string | null;
  calls: number;
  sentBy: string | null;
  sentAt: string;
  ref: ReviewRef;
};

export type ReviewSummary = {
  id: string;
  title: string;
  status: "open" | "approved" | "closed";
  robotId: string;
  robot: string;
  systemId: string | null;
  system: string | null;
  assemblyUrl: string;
  ownerId: string | null;
  owner: string | null;
  activityAt: string;
  rounds: ReviewRound[]; // oldest first
};

// Every review, newest activity first (CAD Review's list), or one review with its rounds.
// Database reads only.
export async function listReviews(reviewId?: string): Promise<ReviewSummary[]> {
  const rows = await db
    .select({ r: designReviews, robot: robots.name, system: systems.name, owner: members.name })
    .from(designReviews)
    .innerJoin(robots, eq(robots.id, designReviews.robotId))
    .leftJoin(systems, eq(systems.id, designReviews.systemId))
    .leftJoin(members, eq(members.id, designReviews.ownerId))
    .where(reviewId ? eq(designReviews.id, reviewId) : undefined)
    .orderBy(desc(designReviews.activityAt));
  if (!rows.length) return [];
  const rounds = await db
    .select({ round: reviewRounds, by: members.name })
    .from(reviewRounds)
    .leftJoin(members, eq(members.id, reviewRounds.sentBy))
    .where(inArray(reviewRounds.reviewId, rows.map((r) => r.r.id)))
    .orderBy(asc(reviewRounds.seq));
  const byReview = new Map<string, ReviewRound[]>();
  for (const { round, by } of rounds) {
    const list = byReview.get(round.reviewId) ?? [];
    list.push({
      id: round.id,
      seq: round.seq,
      state: round.state,
      note: round.note,
      error: round.error,
      calls: round.calls,
      sentBy: by,
      sentAt: round.sentAt.toISOString(),
      ref: round.onshapeRef,
    });
    byReview.set(round.reviewId, list);
  }
  return rows.map(({ r, robot, system, owner }) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    robotId: r.robotId,
    robot,
    systemId: r.systemId,
    system,
    assemblyUrl: r.assemblyUrl,
    ownerId: r.ownerId,
    owner,
    activityAt: r.activityAt.toISOString(),
    rounds: byReview.get(r.id) ?? [],
  }));
}

export async function getReview(reviewId: string): Promise<ReviewSummary | null> {
  return (await listReviews(reviewId))[0] ?? null;
}
