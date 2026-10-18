import Link from "next/link";
import { ProgressBar, StatusBar } from "@/components/StatusBar";
import { requireMember } from "@/lib/auth";
import { listRobots, type RobotSummary } from "@/lib/data/robots";
import { setRobotArchived } from "./robots/actions";

export default async function HomePage() {
  await requireMember();
  const robots = await listRobots();
  const active = robots.filter((r) => !r.archived);
  const archived = robots.filter((r) => r.archived);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Robots</h1>
        <Link href="/robots/new" className="btn-primary">
          + New robot
        </Link>
      </div>

      {active.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-sm text-slate-400">
          No robots yet. Create one, then add its systems from their Onshape assemblies.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {active.map((r) => (
            <RobotCard key={r.id} robot={r} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-400">Archived ({archived.length})</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {archived.map((r) => (
              <RobotCard key={r.id} robot={r} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function RobotCard({ robot }: { robot: RobotSummary }) {
  return (
    <div className="panel flex flex-col gap-3 p-4">
      <Link href={`/robots/${robot.id}`} className="group">
        <div className="text-lg font-semibold group-hover:text-indigo-300">{robot.name}</div>
        <div className="text-sm text-slate-400">{robot.year}</div>
      </Link>
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">{robot.breakdown.percent}% complete</span>
        <ProgressBar done={robot.breakdown.done} total={robot.breakdown.total} />
      </div>
      <StatusBar breakdown={robot.breakdown} legend={false} />
      <form action={setRobotArchived.bind(null, robot.id, !robot.archived)} className="mt-auto">
        <button className="text-xs text-slate-500 hover:text-slate-200">
          {robot.archived ? "Unarchive" : "Archive"}
        </button>
      </form>
    </div>
  );
}
