import { notFound } from "next/navigation";
import { FabHeading, FabView } from "@/components/fab/FabView";
import { requireMember } from "@/lib/auth";
import { listRobotGroups } from "@/lib/data/groups";
import { listInventoryNames } from "@/lib/data/inventory";
import { listMemberNames, listRobotParts } from "@/lib/data/parts";
import { getRobot } from "@/lib/data/robots";
import { isUuid } from "@/lib/uuid";

// Fab batches are part groups with a machine; groups named "FAB n" come from before batches had one.
const isFabBatch = (g: { name: string; machine: string | null }) => !!g.machine || /^FAB \d+$/.test(g.name);

// To Fab: the shop's queue per machine, with fab batches (stored as the robot's part groups).
export default async function FabPage({ params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  // One round of queries in parallel; the machine filter (?machine=) runs on the client, so
  // switching machines doesn't come back here.
  const [member, data, parts, batches, inventory, memberNames] = await Promise.all([
    requireMember(),
    getRobot(robotId),
    listRobotParts(robotId),
    listRobotGroups(robotId),
    listInventoryNames(),
    listMemberNames(),
  ]);
  if (!data) notFound();

  return (
    <div className="space-y-5">
      <FabHeading robotName={data.robot.name} />
      <FabView
        parts={parts}
        batches={batches.filter(isFabBatch).map(({ id, name, machine, madeBy, priority }) => ({ id, name, machine, madeBy, priority }))}
        me={member.name}
        memberNames={memberNames}
        robotId={data.robot.id}
        inventory={inventory}
        isAdmin={member.isAdmin}
      />
    </div>
  );
}
