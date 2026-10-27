import Link from "next/link";
import { notFound } from "next/navigation";
import { InventoryView } from "@/components/inventory/InventoryView";
import { CATEGORY_GROUPS } from "@/config/inventory";
import { requireMember } from "@/lib/auth";
import { listInventory } from "@/lib/data/inventory";

// One inventory category's item cards, under a route back to its group and the Inventory home.
export default async function InventoryCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  await requireMember();
  const { category } = await params;
  const inventory = await listInventory();
  const c = inventory.categories.find((x) => x.id === category);
  if (!c) notFound();
  const group = CATEGORY_GROUPS.find((g) => g.id === c.group)!;
  const crumb = "rounded px-1 hover:text-accent";
  return (
    <div className="space-y-4">
      <div>
        <nav aria-label="Category route" className="flex items-center gap-1 text-xs font-semibold tracking-wide text-subtle uppercase">
          <Link href="/inventory" className={crumb}>
            Inventory
          </Link>
          <span>/</span>
          <Link href={`/inventory?group=${group.id}`} className={crumb}>
            {group.label}
          </Link>
          <span>/</span>
          <span className="px-1 text-fg">{c.label}</span>
        </nav>
        <h1 className="display text-3xl text-accent">{c.label}</h1>
      </div>
      <InventoryView {...inventory} scope={{ kind: "category", id: c.id }} />
    </div>
  );
}
