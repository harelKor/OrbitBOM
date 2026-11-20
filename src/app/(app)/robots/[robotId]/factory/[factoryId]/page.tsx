import Link from "next/link";
import { notFound } from "next/navigation";
import { getMachine, isFactoryFabMachine, packsByMaterial } from "@/config/machines";
import { factoryOf } from "@/lib/status";
import { FactoryView } from "@/components/factory/FactoryView";
import { MarkSeen } from "@/components/shell/Arrivals";
import { requireMember } from "@/lib/auth";
import { getSeenAt } from "@/lib/data/seen";
import { autoPackByMaterial } from "@/lib/factory/autoPack";
import { listRobotGroups } from "@/lib/data/groups";
import { listInventoryNames } from "@/lib/data/inventory";
import { listRobotParts } from "@/lib/data/parts";
import { getRobot } from "@/lib/data/robots";
import { isUuid } from "@/lib/uuid";

// One factory's Factory Fab page: its Released parts, then its packs, then In Stock.
export default async function FactoryPage({ params }: { params: Promise<{ robotId: string; factoryId: string }> }) {
  const { robotId, factoryId } = await params;
  if (!isUuid(robotId) || !isFactoryFabMachine(factoryId)) notFound();
  const member = await requireMember();
  // Zivudim's Released parts go into packs by material before the page reads them.
  await autoPackByMaterial(robotId, factoryId);
  // The new parts glow: when this member last opened this factory's page, from before this visit.
  const seenPage = `factory:${robotId}:${factoryId}`;
  const [data, parts, groups, inventory, seenAt] = await Promise.all([
    getRobot(robotId),
    listRobotParts(robotId),
    listRobotGroups(robotId),
    listInventoryNames(),
    getSeenAt(member.id, seenPage),
  ]);
  if (!data) notFound();
  const factory = getMachine(factoryId)!;

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/robots/${robotId}/factory`} className="text-xs font-semibold tracking-wide text-subtle uppercase hover:text-fg">
          {data.robot.name} · Factory Fab
        </Link>
        <h1 className="display text-3xl text-accent">{factory.name}</h1>
      </div>
      <MarkSeen page={seenPage} />
      <FactoryView
        seenAt={seenAt}
        factory={factory.id}
        byMaterial={packsByMaterial(factory.id)}
        parts={parts.filter((p) => p.classification !== "cots" && factoryOf(p) === factory.id)}
        packs={groups
          .filter((g) => g.machine === factory.id)
          .map(({ id, name, machine, madeBy, priority, gcode, createdAt }) => ({ id, name, machine, madeBy, priority, gcode, createdAt: createdAt.toISOString() }))}
        robotId={data.robot.id}
        inventory={inventory}
        isAdmin={member.isAdmin}
        me={member.name}
      />
    </div>
  );
}
