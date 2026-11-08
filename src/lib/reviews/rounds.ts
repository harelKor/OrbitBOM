import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ReviewModel, ReviewRef } from "@/db/schema";
import { planModel, runJobs } from "@/lib/model/build";
import { onshapeClient, OnshapeError } from "@/lib/onshape/client";
import { onshapeUrl, parseOnshapeUrl } from "@/lib/onshape/url";
import { imageUrl, StorageNotConfiguredError, storageConfigured } from "@/lib/storage/r2";

const { designReviews, reviewRounds } = schema;

// CAD Review rounds (plan/design-review.md). A round is the assembly frozen when the student
// presses Send for review, and its 3D model is built once from that frozen state:
//   - freeze: the document's current microversion (1 call; a version link is frozen already);
//   - plan: the assembly definition (1 call) and each Part Studio's revision (1 call per document
//     context, versions kept), see planModel;
//   - export: one tessellation per Part Studio revision not already in R2 (shared with the robot
//     model, so an unchanged Part Studio costs nothing).
// Viewing a round only reads R2: mentors opening it never call Onshape.

// The Onshape page of a frozen round, for "Open in Onshape".
export const roundUrl = (ref: ReviewRef) => onshapeUrl({ baseUrl: ref.baseUrl, did: ref.did, wvm: ref.wvm, wvmid: ref.wvmid, eid: ref.eid });

// Freezes the review's assembly as its next round. Refuses a round of the same state as the
// last one, so pressing Send twice costs nothing.
export async function sendRound(reviewId: string, memberId: string, note: string | null): Promise<{ id: string; seq: number }> {
  const [review] = await db.select().from(designReviews).where(eq(designReviews.id, reviewId));
  if (!review) throw new OnshapeError("This review is gone.");
  if (review.status !== "open") throw new OnshapeError("Reopen the review to send a new round.");
  const linked = parseOnshapeUrl(review.assemblyUrl);
  if (!linked?.eid) throw new OnshapeError("The review's Onshape link isn't an assembly.");

  let ref: ReviewRef;
  if (linked.wvm === "w") {
    const client = onshapeClient(memberId, linked.baseUrl);
    const { microversion } = await client.json<{ microversion: string }>(`documents/d/${linked.did}/w/${linked.wvmid}/currentmicroversion`);
    ref = { baseUrl: linked.baseUrl, did: linked.did, wvm: "m", wvmid: microversion, eid: linked.eid };
  } else ref = { baseUrl: linked.baseUrl, did: linked.did, wvm: linked.wvm, wvmid: linked.wvmid, eid: linked.eid };

  return db.transaction(async (tx) => {
    await tx.select({ id: designReviews.id }).from(designReviews).where(eq(designReviews.id, reviewId)).for("update");
    const [last] = await tx.select().from(reviewRounds).where(eq(reviewRounds.reviewId, reviewId)).orderBy(desc(reviewRounds.seq)).limit(1);
    if (last && last.onshapeRef.wvmid === ref.wvmid && last.onshapeRef.eid === ref.eid) {
      throw new OnshapeError(`Nothing changed in Onshape since round ${last.seq}.`);
    }
    const seq = (last?.seq ?? 0) + 1;
    const [round] = await tx
      .insert(reviewRounds)
      .values({ reviewId, seq, onshapeRef: ref, note: note?.trim() || null, sentBy: memberId })
      .returning({ id: reviewRounds.id, seq: reviewRounds.seq });
    await tx.update(designReviews).set({ activityAt: new Date() }).where(eq(designReviews.id, reviewId));
    return round;
  });
}

export type RoundStep = { state: "ready"; calls: number } | { state: "working"; done: number; total: number; calls: number };

// One build step of a round on the member's Onshape account; the browser calls again while the
// answer says "working". Progress is saved after every step, so a failure (the day's budget, a
// lost connection) resumes where it stopped.
export async function buildRoundStep(roundId: string, memberId: string, deadline: number): Promise<RoundStep> {
  if (!storageConfigured()) throw new StorageNotConfiguredError();
  const [round] = await db.select().from(reviewRounds).where(eq(reviewRounds.id, roundId));
  if (!round) throw new OnshapeError("This round is gone.");
  if (round.state === "ready") return { state: "ready", calls: 0 };
  const ref = round.onshapeRef;
  const client = onshapeClient(memberId, ref.baseUrl);
  let model: ReviewModel | null = round.model;
  try {
    if (!model) {
      const source = { baseUrl: ref.baseUrl, did: ref.did, wvm: ref.wvm, wvmid: ref.wvmid, eid: ref.eid, group: { systemIds: [], name: "" } };
      const plan = await planModel(client, [source], `review:${ref.wvm}${ref.wvmid}`);
      model = { jobs: plan.jobs, placements: plan.placements.map((p) => ({ s: p.s, k: p.k, t: p.t })), names: plan.names };
      if (!model.placements.length) throw new OnshapeError("Onshape sent no parts for this assembly.");
    }
    await runJobs(client, model, deadline);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(reviewRounds)
      .set({ model, error: message.slice(0, 300), calls: sql`${reviewRounds.calls} + ${client.calls}` })
      .where(eq(reviewRounds.id, roundId));
    throw err;
  }
  const done = model.jobs.filter((j) => j.done).length;
  const ready = done === model.jobs.length;
  await db
    .update(reviewRounds)
    .set({ model, error: null, calls: sql`${reviewRounds.calls} + ${client.calls}`, ...(ready ? { state: "ready" as const, builtAt: new Date() } : {}) })
    .where(and(eq(reviewRounds.id, roundId), eq(reviewRounds.state, "building")));
  return ready ? { state: "ready", calls: client.calls } : { state: "working", done, total: model.jobs.length, calls: client.calls };
}

// A ready round's model for the viewer: short-lived links to its mesh files and every part's
// name (the BOM's name when the part is on it, else Onshape's instance name). A database read only.
export async function roundModel(roundId: string) {
  const [round] = await db.select().from(reviewRounds).where(eq(reviewRounds.id, roundId));
  if (!round?.model || round.state !== "ready" || !storageConfigured()) return null;
  const keys = [...new Set(round.model.placements.map((p) => p.k))];
  const { parts } = schema;
  const partKey = sql<string>`${parts.sourceDid} || ':' || ${parts.sourceEid} || ':' || ${parts.onshapePartId}`;
  const bom = keys.length
    ? await db
        .select({ key: partKey, name: sql<string | null>`coalesce(${parts.displayName}, ${parts.onshapeName})` })
        .from(parts)
        .where(inArray(partKey, keys))
    : [];
  const names: Record<string, string> = { ...round.model.names };
  for (const b of bom) if (b.name) names[b.key] = b.name;
  return {
    studios: await Promise.all(round.model.jobs.map((j) => imageUrl(j.key))),
    placements: round.model.placements,
    names,
  };
}
