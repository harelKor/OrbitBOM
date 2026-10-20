import { notFound } from "next/navigation";
import { ReviewView } from "@/components/review/ReviewView";
import { requireMember } from "@/lib/auth";
import { listRobotParts } from "@/lib/data/parts";
import { getRobot } from "@/lib/data/robots";
import { listRobotReviews } from "@/lib/review/review";

// To Review: parts whose material, processes or type were set automatically, by Suggest setup
// or by a member's Claude, waiting for their designer to approve or reject.
export default async function ReviewPage({ params }: { params: Promise<{ robotId: string }> }) {
  await requireMember();
  const { robotId } = await params;
  const data = await getRobot(robotId);
  if (!data) notFound();
  const [parts, reviews] = await Promise.all([listRobotParts(data.robot.id), listRobotReviews(data.robot.id)]);
  const byPart = new Map(parts.map((p) => [p.id, p]));
  const items = reviews.flatMap((r) => {
    const part = byPart.get(r.partId);
    return part ? [{ part, source: r.source, reason: r.reason, changes: r.changes, at: r.createdAt.toISOString() }] : [];
  });

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">{data.robot.name}</div>
        <h1 className="display text-3xl text-accent">To Review</h1>
      </div>
      <ReviewView robotId={data.robot.id} items={items} />
    </div>
  );
}
