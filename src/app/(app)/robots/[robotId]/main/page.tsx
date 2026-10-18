import Link from "next/link";
import { notFound } from "next/navigation";
import { BomView } from "@/components/bom/BomView";
import { ProgressBar, StatusBar } from "@/components/StatusBar";
import { requireMember } from "@/lib/auth";
import { listMemberNames, listRobotParts } from "@/lib/data/parts";
import { getRobot } from "@/lib/data/robots";

// "Main": every part of every system on one page (ref §1). No merge, bulk edit or Advanced panel.
export default async function MainPage({ params }: { params: Promise<{ robotId: string }> }) {
  await requireMember();
  const { robotId } = await params;
  const data = await getRobot(robotId);
  if (!data) notFound();
  const { robot, breakdown, systems } = data;
  const [parts, memberNames] = await Promise.all([listRobotParts(robot.id), listMemberNames()]);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/robots/${robot.id}`} className="text-sm text-slate-400 hover:text-slate-100">
          ← {robot.name}
        </Link>
        <h1 className="mt-1 text-3xl font-semibold">Main</h1>
        <div className="text-sm text-slate-400">All systems of {robot.name}</div>
      </div>
      <section className="panel p-5">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="text-3xl font-semibold">{breakdown.percent}%</span>
          <span className="text-sm text-slate-400">
            {breakdown.done} / {breakdown.total} parts done
          </span>
        </div>
        <StatusBar breakdown={breakdown} />
      </section>
      <ul className="panel divide-y divide-slate-800 px-5">
        {systems.map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-3">
            <span className="flex-1">{s.name}</span>
            <ProgressBar done={s.breakdown.done} total={s.breakdown.total} />
          </li>
        ))}
      </ul>
      <BomView parts={parts} memberNames={memberNames} showSystem />
    </div>
  );
}
