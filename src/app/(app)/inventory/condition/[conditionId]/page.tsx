import Link from "next/link";
import { notFound } from "next/navigation";
import { InventoryView } from "@/components/inventory/InventoryView";
import { requireMember } from "@/lib/auth";
import { listInventory } from "@/lib/data/inventory";

// The item cards in one condition (a card's condition tag opens it).
export default async function InventoryConditionPage({ params }: { params: Promise<{ conditionId: string }> }) {
  await requireMember();
  const { conditionId } = await params;
  const inventory = await listInventory();
  const c = inventory.conditions.find((x) => x.id === conditionId);
  if (!c) notFound();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/inventory" className="text-xs font-semibold tracking-wide text-subtle uppercase hover:text-fg">
          Inventory
        </Link>
        <h1 className="display text-3xl text-accent">{c.label}</h1>
      </div>
      <InventoryView {...inventory} scope={{ kind: "condition", id: c.id }} />
    </div>
  );
}
