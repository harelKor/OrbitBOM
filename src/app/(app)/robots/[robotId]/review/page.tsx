import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getRobot } from "@/lib/data/robots";

// To Review: parts the automatic material and process classification changed, waiting for
// their designer to approve. The classification isn't built yet, so the list is empty.
export default async function ReviewPage({ params }: { params: Promise<{ robotId: string }> }) {
  await requireMember();
  const { robotId } = await params;
  const data = await getRobot(robotId);
  if (!data) notFound();

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{data.robot.name}</div>
        <h1 className="text-3xl font-semibold">To Review</h1>
      </div>
      <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-slate-400">
        Nothing to review. Parts that are set up automatically will wait here for their designer to approve.
      </div>
    </div>
  );
}
