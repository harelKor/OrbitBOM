import { notFound } from "next/navigation";
import { getMachine } from "@/config/machines";
import { FabView } from "@/components/fab/FabView";
import { requireMember } from "@/lib/auth";
import { listRobotGroups } from "@/lib/data/groups";
import { listInventoryNames } from "@/lib/data/inventory";
import { listRobotParts } from "@/lib/data/parts";
import { getRobot } from "@/lib/data/robots";

// To Fab: the shop's queue per machine, with FAB batches (stored as the robot's part groups).
export default async function FabPage({
  params,
  searchParams,
}: {
  params: Promise<{ robotId: string }>;
  searchParams: Promise<{ machine?: string }>;
}) {
  const member = await requireMember();
  const [{ robotId }, { machine }] = await Promise.all([params, searchParams]);
  const data = await getRobot(robotId);
  if (!data) notFound();
  const [parts, batches, inventory] = await Promise.all([listRobotParts(data.robot.id), listRobotGroups(data.robot.id), listInventoryNames()]);
  const machineName = machine ? getMachine(machine)?.name : undefined;

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">{data.robot.name}</div>
        <h1 className="display text-3xl text-accent">To Fab{machineName && ` · ${machineName}`}</h1>
      </div>
      <FabView
        parts={parts}
        batches={batches.map(({ id, name }) => ({ id, name }))}
        machine={machineName ? machine : undefined}
        robotId={data.robot.id}
        inventory={inventory}
        isAdmin={member.isAdmin}
      />
    </div>
  );
}
