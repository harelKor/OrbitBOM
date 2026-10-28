"use client";

import { useSearchParams } from "next/navigation";
import { pushQuery } from "@/components/ui/CategoryBoxes";
import { CATEGORY_GROUPS, isCategoryGroup } from "@/config/inventory";

// The Inventory home's one route line, at the top of the page: "Inventory / Group / Category",
// following the group and category boxes (?group=, ?cat=). Each step goes back up in place.
export function InventoryCrumbs({ categories }: { categories: { id: string; label: string }[] }) {
  const params = useSearchParams();
  const rawGroup = params.get("group");
  const group = rawGroup && isCategoryGroup(rawGroup) ? CATEGORY_GROUPS.find((g) => g.id === rawGroup) : undefined;
  const cat = group ? categories.find((c) => c.id === params.get("cat")) : undefined;
  const crumb = "press rounded px-1 hover:text-accent active:scale-[0.98]";
  return (
    <nav aria-label="Category route" className="flex flex-wrap items-center gap-1 text-xs font-semibold tracking-wide text-subtle uppercase">
      {group ? (
        <button type="button" onClick={() => pushQuery({ group: null, cat: null })} className={crumb}>
          Inventory
        </button>
      ) : (
        <span className="px-1 text-fg">Inventory</span>
      )}
      {group && (
        <>
          <span>/</span>
          {cat ? (
            <button type="button" onClick={() => pushQuery({ cat: null })} className={crumb}>
              {group.label}
            </button>
          ) : (
            <span className="px-1 text-fg">{group.label}</span>
          )}
        </>
      )}
      {cat && (
        <>
          <span>/</span>
          <span className="px-1 text-fg">{cat.label}</span>
        </>
      )}
    </nav>
  );
}
