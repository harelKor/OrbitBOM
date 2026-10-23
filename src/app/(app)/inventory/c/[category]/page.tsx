import Link from "next/link";
import { notFound } from "next/navigation";
import { InventoryView } from "@/components/inventory/InventoryView";
import { requireMember } from "@/lib/auth";
import { listInventory } from "@/lib/data/inventory";

// One inventory category's item cards.
export default async function InventoryCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  await requireMember();
  const { category } = await params;
  const inventory = await listInventory();
  const c = inventory.categories.find((x) => x.id === category);
  if (!c) notFound();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/inventory" className="text-xs font-semibold tracking-wide text-subtle uppercase hover:text-fg">
          Inventory
        </Link>
        <h1 className="display text-3xl text-accent">{c.label}</h1>
      </div>
      <InventoryView {...inventory} scope={{ kind: "category", id: c.id }} />
    </div>
  );
}
