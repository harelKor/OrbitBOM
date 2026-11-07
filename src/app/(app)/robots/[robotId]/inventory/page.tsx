import { notFound } from "next/navigation";
import { RawStockPlanner } from "@/components/rawStock/RawStockPlanner";
import { can } from "@/components/shell/mode";
import { requireMember } from "@/lib/auth";
import { robotInventory } from "@/lib/data/inventory";
import { robotRawStock } from "@/lib/data/rawStock";
import { getRobot } from "@/lib/data/robots";
import { getMode } from "@/lib/mode";
import { isUuid } from "@/lib/uuid";
import { RobotInventory } from "../RobotInventory";

// The robot's inventory: what its parts draw from the shelf every active robot shares, and the
// raw stock its plate and tube parts take, laid out on stock pieces (Harel, 2026-11-07).
export default async function RobotInventoryPage({ params }: { params: Promise<{ robotId: string }> }) {
  await requireMember();
  const { robotId } = await params;
  if (!isUuid(robotId)) notFound();
  const [data, items, raw, mode] = await Promise.all([getRobot(robotId), robotInventory(robotId), robotRawStock(robotId), getMode()]);
  if (!data) notFound();
  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">{data.robot.name}</div>
        <h1 className="display text-3xl text-accent">Inventory</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">What this robot&apos;s parts take from the team shelf, which every active robot shares.</p>
      </div>
      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Raw stock</h2>
          <p className="max-w-3xl text-sm text-muted">
            Every plate, tube and box tube part, all copies, laid out on stock pieces of the size you pick: how much material to prepare. Colours are the parts&apos; statuses.
          </p>
        </div>
        <RawStockPlanner robotId={data.robot.id} groups={raw} canEdit={can(mode, "work")} />
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Items</h2>
        <RobotInventory robotId={data.robot.id} items={items} />
      </section>
    </div>
  );
}
