import { InventoryCrumbs } from "@/components/inventory/InventoryCrumbs";
import { InventoryView } from "@/components/inventory/InventoryView";
import { requireMember } from "@/lib/auth";
import { listInventory, shelfForPage } from "@/lib/data/inventory";
import { listInventoryActions } from "@/lib/data/inventoryActions";

// The Inventory home: search first, then a box per category and the Short for robots card, then
// Recent actions and All items.
export default async function InventoryPage() {
  const member = await requireMember();
  const [inventory, actions] = await Promise.all([listInventory(), listInventoryActions(member.id)]);
  return (
    <div className="space-y-4">
      <div>
        <InventoryCrumbs categories={inventory.categories} />
        <h1 className="display text-3xl text-accent">Inventory</h1>
      </div>
      <InventoryView {...shelfForPage(inventory)} actions={actions} scope={{ kind: "home" }} />
    </div>
  );
}
