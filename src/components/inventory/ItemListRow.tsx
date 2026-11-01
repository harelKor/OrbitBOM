"use client";

import { ListPill, ListRow } from "@/components/ui/ListRow";
import { getCategory, specLine } from "@/lib/inventory/categories";
import { hasSeasonNeed, missing, neededFor, standing, type NeedView } from "@/lib/inventory/season";
import { formatStock } from "@/lib/inventory/stock";
import { conditionColor, standingTint } from "./ItemCard";
import { useInventoryPopup } from "./InventoryPopup";
import { SeasonTag } from "./SeasonTag";
import type { InvCategory, Item } from "./types";

const STANDING = {
  short: { color: "#f43f5e", label: (gap: string) => `Short ${gap}` },
  ordered: { color: "#f59e0b", label: () => "On order" },
  ok: { color: "#10b981", label: () => "Covered" },
};

// An inventory item as one row of the List view: its picture, name, "stock / need · specs", and
// pills for its location, condition, season tag and standing, washed in its standing colour like its card. A tap opens the item's window.
export function ItemListRow({
  item,
  categories,
  condition,
  location,
  view = "any",
  hideCategory = false,
  selected,
  onToggleSelect,
  glow,
}: {
  item: Item;
  categories: InvCategory[];
  condition?: { id: string; label: string; color: string };
  location?: { id: string; name: string };
  view?: NeedView;
  hideCategory?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  glow?: "lit" | "fade";
}) {
  const { openItem } = useInventoryPopup();
  const category = getCategory(categories, item.category);
  const needed = neededFor(item, view);
  const gap = missing(item, view);
  const state = standing(item, view);
  // Like the cards: only an item with a need (or on order) wears its standing.
  const showStanding = (view === "robots" ? needed != null : hasSeasonNeed(item)) || state === "ordered";
  const spec = specLine(category, item.specs);
  const detail = [!hideCategory && category?.label, spec].filter(Boolean).join(" · ");
  return (
    <ListRow
      data-item={item.id}
      data-new={glow}
      style={standingTint(item, view)}
      picture={item.thumbUrl ?? category?.imageUrl ?? null}
      dimPicture={!item.thumbUrl}
      title={item.name}
      detail={
        <>
          <span className="font-mono tabular-nums">
            <span className={gap > 0 ? "text-rose-400" : undefined}>{formatStock(item.inStock, item.sheet)}</span>
            {needed != null && ` / ${formatStock(needed, item.sheet)}`}
          </span>{" "}
          in stock{detail && ` · ${detail}`}
        </>
      }
      pills={
        <>
          {location && <ListPill>📍 {location.name}</ListPill>}
          {condition && <ListPill color={conditionColor(condition.color)}>{condition.label}</ListPill>}
          <SeasonTag itemId={item.id} tag={item.seasonTag} className="rounded-full border border-transparent px-2.5 py-0.5 text-[11px]" />
          {showStanding && <ListPill color={STANDING[state].color}>{STANDING[state].label(formatStock(gap, item.sheet))}</ListPill>}
        </>
      }
      onOpen={() => openItem(item.id, item)}
      selected={selected}
      onToggleSelect={onToggleSelect}
    />
  );
}
