import { InventoryView } from "@/components/inventory/InventoryView";
import { requireMember } from "@/lib/auth";
import { listInventory } from "@/lib/data/inventory";

// The Inventory home: search first, then a box per category and the Short for robots card.
export default async function InventoryPage() {
  await requireMember();
  const inventory = await listInventory();
  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold tracking-wide text-subtle uppercase">Shop</div>
        <h1 className="display text-3xl text-accent">Inventory</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          What the team owns. Every active robot shares the same shelf: the parts linked to an item draw on its stock
          together, and the COTS cards show what&apos;s covered and what to order. Plates count in sheets and pieces of a
          sheet.
        </p>
      </div>
      <InventoryView {...inventory} scope={{ kind: "home" }} />
    </div>
  );
}
