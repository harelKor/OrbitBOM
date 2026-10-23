import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemPage } from "@/components/inventory/ItemPage";
import { requireMember } from "@/lib/auth";
import { inventoryItemDetail } from "@/lib/data/inventory";
import { listBomTargets } from "@/lib/data/robots";
import { isUuid } from "@/lib/uuid";

// One inventory item: its stock and history, the parts that use it, and parts that look like it.
export default async function InventoryItemPage({ params }: { params: Promise<{ itemId: string }> }) {
  await requireMember();
  const { itemId } = await params;
  if (!isUuid(itemId)) notFound();
  const [detail, targets] = await Promise.all([inventoryItemDetail(itemId), listBomTargets()]);
  if (!detail) notFound();
  const category = detail.categories.find((c) => c.id === detail.item.category);
  return (
    <div className="space-y-4">
      <div className="text-xs font-semibold tracking-wide text-subtle uppercase">
        <Link href="/inventory" className="hover:text-fg">
          Inventory
        </Link>
        {category && (
          <>
            {" › "}
            <Link href={`/inventory/c/${category.id}`} className="hover:text-fg">
              {category.label}
            </Link>
          </>
        )}
      </div>
      <ItemPage {...detail} targets={targets} />
    </div>
  );
}
