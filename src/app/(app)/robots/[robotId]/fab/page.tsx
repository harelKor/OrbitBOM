import { notFound } from "next/navigation";
import { getMachine } from "@/config/machines";
import { requireMember } from "@/lib/auth";
import { getRobot } from "@/lib/data/robots";

// To Fab: the shop's queue per machine. The page itself comes with FAB batches (Phase C).
export default async function FabPage({
  params,
  searchParams,
}: {
  params: Promise<{ robotId: string }>;
  searchParams: Promise<{ machine?: string }>;
}) {
  await requireMember();
  const [{ robotId }, { machine }] = await Promise.all([params, searchParams]);
  const data = await getRobot(robotId);
  if (!data) notFound();
  const machineName = machine ? getMachine(machine)?.name : undefined;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">{data.robot.name}</div>
        <h1 className="display text-3xl text-accent">To Fab{machineName && ` · ${machineName}`}</h1>
      </div>
      <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-muted">
        The To Fab queue and FAB batches are coming in the next update.
      </div>
    </div>
  );
}
