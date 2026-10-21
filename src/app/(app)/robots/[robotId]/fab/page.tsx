import { notFound } from "next/navigation";
import { getMachine } from "@/config/machines";
import { FabView } from "@/components/fab/FabView";
import { requireMember } from "@/lib/auth";
import { listRobotGroups } from "@/lib/data/groups";
import { listInventoryNames } from "@/lib/data/inventory";
import { listMemberNames, listRobotParts } from "@/lib/data/parts";
import { getRobot } from "@/lib/data/robots";

// Fab batches are part groups with a machine; groups named "FAB n" come from before batches had one.
const isFabBatch = (g: { name: string; machine: string | null }) => !!g.machine || /^FAB \d+$/.test(g.name);

// To Fab: the shop's queue per machine, with fab batches (stored as the robot's part groups).
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
  const [parts, batches, inventory, memberNames] = await Promise.all([
    listRobotParts(data.robot.id),
    listRobotGroups(data.robot.id),
    listInventoryNames(),
    listMemberNames(),
  ]);
  const machineName = machine ? getMachine(machine)?.name : undefined;

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">{data.robot.name}</div>
        <h1 className="display text-3xl text-accent">To Fab{machineName && ` · ${machineName}`}</h1>
      </div>
      <FabView
        parts={parts}
        batches={batches.filter(isFabBatch).map(({ id, name, machine, madeBy }) => ({ id, name, machine, madeBy }))}
        memberNames={memberNames}
        machine={machineName ? machine : undefined}
        robotId={data.robot.id}
        inventory={inventory}
        isAdmin={member.isAdmin}
      />
    </div>
  );
}
