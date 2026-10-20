import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ProgressBar, StatusBar } from "@/components/StatusBar";
import { requireMember } from "@/lib/auth";
import { robotInventory } from "@/lib/data/inventory";
import { getRobot } from "@/lib/data/robots";
import { isEditMode } from "@/lib/mode";
import { deleteRobot, deleteSystem, setRobotArchived, updateRobot } from "../actions";
import { NewSystemButton } from "./NewSystemButton";
import { RobotInventory } from "./RobotInventory";

export default async function RobotPage({ params }: { params: Promise<{ robotId: string }> }) {
  const member = await requireMember();
  const { robotId } = await params;
  const data = await getRobot(robotId);
  if (!data) notFound();
  const { robot, breakdown, systems } = data;
  const [inventory, edit] = await Promise.all([robotInventory(robot.id), isEditMode()]);
  const update = updateRobot.bind(null, robot.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Robot</div>
          <h1 className="text-3xl font-semibold">{robot.name}</h1>
          <div className="text-sm text-slate-400">{robot.year}</div>
        </div>
        {edit && <NewSystemButton robotId={robot.id} />}
      </div>

      {edit && <div className="flex flex-wrap items-end gap-6">
        <form action={update} className="flex items-end gap-2">
          <div>
            <label className="label" htmlFor="code">
              Robot code
            </label>
            <input id="code" name="code" defaultValue={robot.code ?? ""} className="input w-24" placeholder="e.g. A" />
          </div>
          <button className="btn">Save</button>
        </form>
        <form action={update} className="flex items-end gap-2">
          <div>
            <label className="label" htmlFor="deadline">
              Deadline
            </label>
            <input id="deadline" name="deadline" type="date" defaultValue={robot.deadline ?? ""} className="input" />
          </div>
          <button className="btn">Save</button>
        </form>
        <form action={setRobotArchived.bind(null, robot.id, !robot.archived)}>
          <button className="btn">{robot.archived ? "Unarchive robot" : "Archive robot"}</button>
        </form>
      </div>}

      <section className="panel p-5">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="text-3xl font-semibold">{breakdown.percent}%</span>
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase">complete</span>
          <span className="text-sm text-slate-400">
            {breakdown.done} / {breakdown.total} parts done
          </span>
        </div>
        <StatusBar breakdown={breakdown} />
      </section>

      <section className="panel p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Systems</h2>
          {edit && <span className="text-xs text-slate-500">Add systems with the New system button above.</span>}
        </div>
        <ul className="divide-y divide-line">
          <li>
            <Link
              href={`/robots/${robot.id}/main`}
              className="flex items-center gap-3 py-3 hover:text-accent-soft"
            >
              <span className="flex-1 font-medium">Main</span>
              <span className="text-xs text-slate-500">All systems</span>
            </Link>
          </li>
          {systems.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <Link href={`/robots/${robot.id}/systems/${s.id}`} className="flex-1 font-medium hover:text-accent-soft">
                {s.name}
              </Link>
              <ProgressBar done={s.breakdown.done} total={s.breakdown.total} />
              {s.assemblyUrl && (
                <a href={s.assemblyUrl} target="_blank" rel="noreferrer" className="text-xs text-slate-400 hover:text-slate-100">
                  Onshape ↗
                </a>
              )}
              {edit && member.isAdmin && (
                <ConfirmButton
                  action={deleteSystem.bind(null, robot.id, s.id)}
                  message={`Delete the system "${s.name}" and all its parts? This can't be undone.`}
                  className="text-xs text-rose-400 hover:text-rose-200"
                >
                  Delete
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
        {systems.length === 0 && <p className="py-3 text-sm text-slate-500">No systems yet.</p>}
      </section>

      <RobotInventory items={inventory} />

      {edit && member.isAdmin && (
        <div className="flex justify-end">
          <ConfirmButton
            action={deleteRobot.bind(null, robot.id)}
            message={`Delete the robot "${robot.name}", all its systems and parts? This can't be undone.`}
          >
            Delete robot
          </ConfirmButton>
        </div>
      )}
    </div>
  );
}
