import Link from "next/link";
import { notFound } from "next/navigation";
import { getMachine, isPrinter, printerOf } from "@/config/machines";
import { FactoryView } from "@/components/factory/FactoryView";
import { requireMember } from "@/lib/auth";
import { listRobotGroups } from "@/lib/data/groups";
import { listInventoryNames } from "@/lib/data/inventory";
import { listRobotParts } from "@/lib/data/parts";
import { getRobot } from "@/lib/data/robots";
import { isUuid } from "@/lib/uuid";

// One printer's 3D Printing page: its Released parts, then its packs, then In Stock. Packs are
// made by hand (＋ Pack) and named by nothing but their day (Harel, 2026-11-04).
export default async function PrinterPage({ params }: { params: Promise<{ robotId: string; printerId: string }> }) {
  const { robotId, printerId } = await params;
  if (!isUuid(robotId) || !isPrinter(printerId)) notFound();
  const [member, data, parts, groups, inventory] = await Promise.all([
    requireMember(),
    getRobot(robotId),
    listRobotParts(robotId),
    listRobotGroups(robotId),
    listInventoryNames(),
  ]);
  if (!data) notFound();
  const printer = getMachine(printerId)!;

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/robots/${robotId}/printing`} className="text-xs font-semibold tracking-wide text-subtle uppercase hover:text-fg">
          {data.robot.name} · 3D Printing
        </Link>
        <h1 className="display text-3xl text-accent">{printer.name}</h1>
      </div>
      <FactoryView
        area="print"
        factory={printer.id}
        parts={parts.filter((p) => p.classification !== "cots" && printerOf(p) === printer.id)}
        packs={groups
          .filter((g) => g.machine === printer.id)
          .map(({ id, name, machine, madeBy, priority, gcode, createdAt }) => ({ id, name, machine, madeBy, priority, gcode, createdAt: createdAt.toISOString() }))}
        robotId={data.robot.id}
        inventory={inventory}
        isAdmin={member.isAdmin}
        me={member.name}
      />
    </div>
  );
}
