import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getReview } from "@/lib/data/reviews";
import { hasCapability } from "@/lib/mode";
import { isUuid } from "@/lib/uuid";
import { StatusChip } from "../StatusChip";
import { ReviewScreen } from "./ReviewScreen";

export default async function ReviewPage({ params }: { params: Promise<{ reviewId: string }> }) {
  const member = await requireMember();
  const { reviewId } = await params;
  if (!isUuid(reviewId)) notFound();
  const [review, canSync] = await Promise.all([getReview(reviewId), hasCapability("sync")]);
  if (!review) notFound();

  return (
    <div className="mx-auto max-w-[96rem] space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href="/reviews" className="press text-sm text-muted hover:text-fg pointer-coarse:min-h-9">
          ← CAD Review
        </Link>
        <h1 className="display min-w-0 truncate text-2xl text-accent md:text-3xl">{review.title}</h1>
        <StatusChip status={review.status} />
        <span className="text-sm text-muted">
          {review.robot}
          {review.system ? ` › ${review.system}` : ""}
          {review.owner ? ` · ${review.owner}` : ""}
        </span>
      </div>
      <ReviewScreen review={review} canSend={canSync && member.onshapeConnected} isOwnerOrAdmin={review.ownerId === member.id || member.isAdmin} />
    </div>
  );
}
