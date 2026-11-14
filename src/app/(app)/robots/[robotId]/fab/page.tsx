import { notFound } from "next/navigation";
import { areaOfMachine } from "@/config/machines";
import { FabHeading, FabView } from "@/components/fab/FabView";
import { MarkSeen } from "@/components/shell/Arrivals";
import { requireMember } from "@/lib/auth";
import { getSeenAt } from "@/lib/data/seen";
import { listRobotGroups } from "@/lib/data/groups";
import { listInventoryNames } from "@/lib/data/inventory";
import { listMemberNames, listRobotParts } from "@/lib/data/parts";
import { getRobot } from "@/lib/data/robots";
import { isUuid } from "@/lib/uuid";

// Fab batches are part groups with a machine; groups named "FAB n" come from before batches had one.
// A factory's or team printer's packs are on Factory Fab or 3D Printing instead.
const isFabBatch = (g: { name: string; machine: string | null }) => (!!g.machine && !areaOfMachine(g.machine)) || /^FAB \d+$/.test(g.name);

// To Fab: the shop's queue per machine, with fab batches (stored as the robot's part groups).
export default async function FabPage({ params }: { params: Promise<{ robotId: string }> }) {
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  // One round of queries in parallel; the machine filter (?machine=) runs on the client, so
  // switching machines doesn't come back here.
  const member = await requireMember();
  // The new parts glow: when this member last opened Shop Fab, from before this visit.
  const seenPage = `fab:${robotId}`;
  const [data, parts, batches, inventory, memberNames, seenAt] = await Promise.all([
    getRobot(robotId),
    listRobotParts(robotId),
    listRobotGroups(robotId),
    listInventoryNames(),
    listMemberNames(),
    getSeenAt(member.id, seenPage),
  ]);
  if (!data) notFound();

  return (
    <div className="space-y-5">
      <MarkSeen page={seenPage} />
      <FabHeading robotName={data.robot.name} />
      <FabView
        parts={parts}
        batches={batches.filter(isFabBatch).map(({ id, name, machine, madeBy, priority, gcode, onshapeLayoutUrl, createdAt }) => ({ id, name, machine, madeBy, priority, gcode, onshapeLayoutUrl, createdAt: createdAt.toISOString() }))}
        me={member.name}
        memberNames={memberNames}
        robotId={data.robot.id}
        inventory={inventory}
        isAdmin={member.isAdmin}
        seenAt={seenAt}
      />
    </div>
  );
}
