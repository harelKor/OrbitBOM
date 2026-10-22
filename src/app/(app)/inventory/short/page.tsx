import Link from "next/link";
import { InventoryView } from "@/components/inventory/InventoryView";
import { requireMember } from "@/lib/auth";
import { listInventory } from "@/lib/data/inventory";

// Items the active robots need more of than the shelf has.
export default async function InventoryShortPage() {
  await requireMember();
  const inventory = await listInventory();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/inventory" className="text-xs font-semibold tracking-wide text-subtle uppercase hover:text-fg">
          Inventory
        </Link>
        <h1 className="display text-3xl text-accent">Short for robots</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Items whose linked parts, across every active robot, need more than the shelf has. Each robot&apos;s Inventory
          page sends its shortages to the Order List.
        </p>
      </div>
      <InventoryView {...inventory} scope={{ kind: "short" }} />
    </div>
  );
}
