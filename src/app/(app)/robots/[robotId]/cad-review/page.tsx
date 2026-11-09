import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { reviewCounts } from "@/lib/data/cadReview";
import { listShellRobots } from "@/lib/data/shell";
import { robotModelBuiltAt } from "@/lib/model/build";
import { hasCapability } from "@/lib/mode";
import { isUuid } from "@/lib/uuid";
import { ReviewBoard } from "./ReviewBoard";

// CAD (plan/design-review.md; Harel, 2026-11-08 and 2026-11-09): the robot (the one picked in the
// right panel) in a wide 3D box on top, which opens the robot's CAD page, and below it every
// system: a 3D box on wide screens, its picture on phones. Reads the built 3D model only.
export default async function CadPage({ params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  await requireMember();
  const [robots, counts, builtAt, edit] = await Promise.all([listShellRobots(), reviewCounts(robotId), robotModelBuiltAt(robotId), hasCapability("sync")]);
  const robot = robots.find((r) => r.id === robotId);
  if (!robot) notFound();
  const systems = robot.systems
    .filter((s) => s.assemblyUrl)
    .map((s) => ({ id: s.id, name: s.name, thumbUrl: s.thumbUrl, open: counts[s.id]?.open ?? 0, done: counts[s.id]?.done ?? 0 }));

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <h1 className="display text-3xl text-accent">CAD</h1>
      <ReviewBoard robotId={robotId} robotName={robot.name} robotCounts={counts.robot ?? { open: 0, done: 0 }} systems={systems} builtAt={builtAt} edit={edit} />
    </div>
  );
}
