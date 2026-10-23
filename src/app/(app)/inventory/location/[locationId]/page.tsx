import Link from "next/link";
import { notFound } from "next/navigation";
import { InventoryView } from "@/components/inventory/InventoryView";
import { requireMember } from "@/lib/auth";
import { listInventory } from "@/lib/data/inventory";

// The item cards at one location (a card's 📍 tag opens it).
export default async function InventoryLocationPage({ params }: { params: Promise<{ locationId: string }> }) {
  await requireMember();
  const { locationId } = await params;
  const inventory = await listInventory();
  const l = inventory.locations.find((x) => x.id === locationId);
  if (!l) notFound();
  return (
    <div className="space-y-4">
      <div>
        <Link href="/inventory" className="text-xs font-semibold tracking-wide text-subtle uppercase hover:text-fg">
          Inventory
        </Link>
        <h1 className="display text-3xl text-accent">📍 {l.name}</h1>
      </div>
      <InventoryView {...inventory} scope={{ kind: "location", id: l.id }} />
    </div>
  );
}
