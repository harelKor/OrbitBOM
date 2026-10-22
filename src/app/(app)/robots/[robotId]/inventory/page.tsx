import { notFound } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { robotInventory } from "@/lib/data/inventory";
import { getRobot } from "@/lib/data/robots";
import { isUuid } from "@/lib/uuid";
import { RobotInventory } from "../RobotInventory";

// The robot's inventory: what its parts draw from the shelf every active robot shares.
export default async function RobotInventoryPage({ params }: { params: Promise<{ robotId: string }> }) {
  await requireMember();
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  const [data, items] = await Promise.all([getRobot(robotId), robotInventory(robotId)]);
  if (!data) notFound();
  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">{data.robot.name}</div>
        <h1 className="display text-3xl text-accent">Inventory</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">What this robot&apos;s parts take from the team shelf, which every active robot shares.</p>
      </div>
      <RobotInventory robotId={data.robot.id} items={items} />
    </div>
  );
}
