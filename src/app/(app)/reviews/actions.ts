"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireCapability } from "@/lib/mode";
import { OnshapeError } from "@/lib/onshape/client";
import { onshapeUrl, parseOnshapeUrl } from "@/lib/onshape/url";
import { sendRound } from "@/lib/reviews/rounds";
import { isUuid } from "@/lib/uuid";

export type ReviewFormState = { error?: string } | undefined;

const NEEDS_ONSHAPE = "Connect your Onshape account first (Profile → Connect Onshape): sending a round reads the assembly once.";

const reviewForm = z.object({
  title: z.string().trim().min(1, "Give the design a name."),
  robotId: z.string().refine(isUuid, "Pick a robot."),
  systemId: z.string().optional(),
  assemblyUrl: z.string().trim().optional(),
  note: z.string().trim().max(2000).optional(),
});

// A new review and its first round: a system's assembly, or any assembly link (a prototype not
// in the robot yet). Students send rounds (CAD Team and Edit, with Onshape connected); everyone
// views.
export async function createReview(_: ReviewFormState, formData: FormData): Promise<ReviewFormState> {
  const member = await requireCapability("sync");
  if (!member.onshapeConnected) return { error: NEEDS_ONSHAPE };
  const parsed = reviewForm.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { title, robotId, note } = parsed.data;
  const systemId = parsed.data.systemId && isUuid(parsed.data.systemId) ? parsed.data.systemId : null;

  let url = parsed.data.assemblyUrl || null;
  if (systemId) {
    const [system] = await db
      .select({ url: schema.systems.assemblyUrl })
      .from(schema.systems)
      .where(and(eq(schema.systems.id, systemId), eq(schema.systems.robotId, robotId)));
    if (!system) return { error: "That system isn't on this robot." };
    url ??= system.url;
  }
  const ref = url ? parseOnshapeUrl(url) : null;
  if (!ref?.eid) return { error: systemId ? "This system has no Onshape assembly: paste the assembly's link." : "Paste an Onshape link to an assembly (…/documents/…/w/…/e/…)." };

  const [review] = await db
    .insert(schema.designReviews)
    .values({ title, robotId, systemId, assemblyUrl: onshapeUrl(ref), ownerId: member.id })
    .returning({ id: schema.designReviews.id });
  try {
    await sendRound(review.id, member.id, note ?? null);
  } catch (err) {
    // Without a first round the review is empty: take it back and say why.
    await db.delete(schema.designReviews).where(eq(schema.designReviews.id, review.id));
    if (err instanceof OnshapeError) return { error: err.message };
    throw err;
  }
  revalidatePath("/reviews");
  redirect(`/reviews/${review.id}`);
}

// Send for review: the assembly as it is in Onshape now becomes the next round.
export async function sendReviewRound(reviewId: string, note: string): Promise<{ error?: string; seq?: number }> {
  const member = await requireCapability("sync");
  if (!isUuid(reviewId)) return { error: "Unknown review." };
  if (!member.onshapeConnected) return { error: NEEDS_ONSHAPE };
  try {
    const round = await sendRound(reviewId, member.id, note);
    revalidatePath(`/reviews/${reviewId}`);
    revalidatePath("/reviews");
    return { seq: round.seq };
  } catch (err) {
    if (err instanceof OnshapeError) return { error: err.message };
    throw err;
  }
}

// Close a review that's no longer needed, or open it again. The student who owns it or an
// admin in Edit mode (approving comes with the mentors' tools).
export async function setReviewClosed(reviewId: string, closed: boolean): Promise<{ error?: string }> {
  const member = await requireCapability("sync");
  if (!isUuid(reviewId)) return { error: "Unknown review." };
  const [review] = await db.select({ ownerId: schema.designReviews.ownerId, status: schema.designReviews.status }).from(schema.designReviews).where(eq(schema.designReviews.id, reviewId));
  if (!review) return { error: "Unknown review." };
  if (review.ownerId !== member.id && !member.isAdmin) return { error: "Only the student who sent it or an admin can close it." };
  if (review.status === "approved") return { error: "An approved review stays approved." };
  await db
    .update(schema.designReviews)
    .set({ status: closed ? "closed" : "open" })
    .where(eq(schema.designReviews.id, reviewId));
  revalidatePath(`/reviews/${reviewId}`);
  revalidatePath("/reviews");
  return {};
}
