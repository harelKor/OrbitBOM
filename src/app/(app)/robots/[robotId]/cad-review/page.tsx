import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { reviewCounts } from "@/lib/data/cadReview";
import { getRobot } from "@/lib/data/robots";
import { robotModelBuiltAt } from "@/lib/model/build";
import { hasCapability } from "@/lib/mode";
import { isUuid } from "@/lib/uuid";
import { ReviewBoard } from "./ReviewBoard";

// CAD Review (plan/design-review.md; Harel, 2026-11-08): every system of the robot (the one picked
// in the right panel) in its own 3D box, the whole robot in a wide one below. A tap on a system
// opens its review page. Reads the robot's built 3D model only: no Onshape calls.
export default async function CadReviewPage({ params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  await requireMember();
  const [data, counts, builtAt, edit] = await Promise.all([getRobot(robotId), reviewCounts(robotId), robotModelBuiltAt(robotId), hasCapability("sync")]);
  if (!data) notFound();
  const systems = data.systems
    .filter((s) => s.assemblyUrl)
    .map((s) => ({ id: s.id, name: s.name, open: counts[s.id]?.open ?? 0, done: counts[s.id]?.done ?? 0 }));

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <h1 className="display text-3xl text-accent">CAD Review</h1>
        <p className="mt-1 text-sm text-muted">
          {data.robot.name}: tap a system to review it. Turn the views like any 3D view; nothing here calls Onshape.
        </p>
      </div>
      <ReviewBoard robotId={robotId} systems={systems} builtAt={builtAt} edit={edit} />
    </div>
  );
}
