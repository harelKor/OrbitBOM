import { InventoryView } from "@/components/inventory/InventoryView";
import { requireMember } from "@/lib/auth";
import { listInventory } from "@/lib/data/inventory";
import { listBomTargets } from "@/lib/data/robots";

export default async function InventoryPage() {
  await requireMember();
  const [inventory, targets] = await Promise.all([listInventory(), listBomTargets()]);
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Shop</div>
        <h1 className="text-3xl font-semibold">Inventory</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Track how many of each COTS part you physically have on hand. Stock is allocated to matching parts in every
          robot&apos;s BOM. Each unit can only be used once per robot, but the same units are available again to
          another robot.
        </p>
      </div>
      <InventoryView {...inventory} targets={targets} />
    </div>
  );
}
