"use client";

import { StepButton } from "@/components/ui/Stepper";
import { useTransition } from "react";
import { setItemCondition, setItemLocation } from "@/app/(app)/inventory/actions";
import { textOn } from "@/components/bom/options";
import { useCan } from "@/components/shell/ModeContext";
import { ListPill, ListRow } from "@/components/ui/ListRow";
import { getCategory, specLine } from "@/lib/inventory/categories";
import { hasSeasonNeed, missing, neededFor, standing, type NeedView } from "@/lib/inventory/season";
import { formatStock, isSheetGoods } from "@/lib/inventory/stock";
import { CountBox, PieceStepper, conditionColor, standingTint } from "./ItemCard";
import { ConditionSelect } from "./ConditionSelect";
import { Icon } from "@/components/ui/Icon";
import { LocationPicker, PlaceTag } from "./LocationPicker";
import { useInventoryPopup } from "./InventoryPopup";
import { SeasonTag } from "./SeasonTag";
import type { Condition, InvCategory, Item, Location } from "./types";

const STANDING = {
  short: { color: "#f43f5e", label: (gap: string) => `Short ${gap}` },
  ordered: { color: "#f59e0b", label: () => "On order" },
  ok: { color: "#10b981", label: () => "Covered" },
};

// An inventory item as one row of the List view: its picture, name, "stock / need · specs", and
// pills for its location, condition, season tag and standing, washed in its standing colour like its card. A tap opens the item's window.
// For a team that can work (and outside a selection) the row also has the card's − / count / +
// stepper (pieces ▾ for fraction items), and its condition and location pills are menus that save
// at once, like the item window's.
export function ItemListRow({
  item,
  categories,
  condition,
  location,
  view = "any",
  hideCategory = false,
  hideSeason = false,
  selected,
  onToggleSelect,
  glow,
  conditions,
  locations,
  onStep,
  onCount,
}: {
  item: Item;
  conditions?: Condition[];
  locations?: Location[];
  onStep?: (delta: number, size?: string) => void;
  onCount?: (amount: number) => void;
  categories: InvCategory[];
  condition?: { id: string; label: string; color: string };
  location?: { id: string; name: string };
  view?: NeedView;
  hideCategory?: boolean;
  hideSeason?: boolean; // filtered to one season: the tag would be the same on every row
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
  const work = useCan("work");
  const [saving, startSaving] = useTransition();
  // While selecting, the pills stay plain so a tap selects the row.
  const editable = work && !onToggleSelect;
  const stepper = editable && onStep && onCount;
  const color = condition ? conditionColor(condition.color) : undefined;
  const sheetWord = item.sheet && isSheetGoods(category?.label ?? item.name);
  // Raw stock rows go without the picture and the 📍 pill (Harel, 2026-11-02).
  const rawStock = item.sheet || category?.group === "consumables";
  return (
    <ListRow
      data-item={item.id}
      data-new={glow}
      style={standingTint(item, view)}
      picture={item.thumbUrl ?? category?.imageUrl ?? null}
      dimPicture={!item.thumbUrl}
      hidePicture={rawStock}
      title={item.name}
      href={item.cotsLinks[0]?.url}
      detail={
        stepper ? (
          detail || undefined
        ) : (
          <>
            <span className="font-mono tabular-nums">
              <span className={gap > 0 ? "text-rose-400" : undefined}>{formatStock(item.inStock, item.sheet)}</span>
              {needed != null && ` / ${formatStock(needed, item.sheet)}`}
            </span>{" "}
            in stock{detail && ` · ${detail}`}
          </>
        )
      }
      pills={
        editable ? (
          // A tap on a control works it, not the row (menus are portaled, so their clicks still
          // bubble through React to the row).
          <span className="contents" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {stepper && (
              <span className="inline-flex items-center gap-1">
                <StepButton
                  step={-1}
                  onClick={() => onStep(-1)}
                  disabled={item.sheet ? item.inStock <= 0 : item.inStock < 1}
                  label={sheetWord ? "One sheet less" : "One less"}
                />
                <span className="flex items-center gap-1 rounded-full bg-[#111318]/80 px-2.5 py-1 font-mono text-xs font-semibold whitespace-nowrap text-white tabular-nums">
                  <span className={gap > 0 ? "text-rose-300" : undefined}>
                    <CountBox item={item} onCount={onCount} />
                  </span>
                  {needed != null && <span className="text-white/70">/ {formatStock(needed, item.sheet)}</span>}
                  {item.sheet && <PieceStepper item={item} onStep={onStep} />}
                </span>
                <StepButton step={1} onClick={() => onStep(1)} label={sheetWord ? "One sheet more" : "One more"} />
              </span>
            )}
            {locations && !rawStock && (
              <LocationPicker
                locations={locations}
                value={item.locationId ?? location?.id ?? null}
                onChange={(id) =>
                  startSaving(async () => {
                    await setItemLocation(item.id, id);
                  })
                }
                disabled={saving}
                ariaLabel={location ? "Place on the shop map" : "Add a place"}
                className={`press max-w-full truncate rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-medium hover:border-sky-400/40 hover:text-accent active:scale-[0.98] disabled:opacity-60 ${
                  location ? "border-line-strong bg-ink/60 text-fg-2" : "border-dashed border-line-strong text-muted"
                }`}
              >
                <PlaceTag place={location ? locations.find((l) => l.id === location.id) : null} places={locations} />
              </LocationPicker>
            )}
            {conditions && (
              <ConditionSelect
                conditions={conditions}
                value={item.conditionId}
                disabled={saving}
                onChange={(conditionId) =>
                  startSaving(async () => {
                    await setItemCondition(item.id, conditionId);
                  })
                }
                emptyLabel="+ Condition"
                className={`press cursor-pointer appearance-none rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold active:scale-[0.98] disabled:opacity-60 ${
                  condition ? "border-transparent hover:brightness-110" : "border-dashed border-line-strong bg-transparent text-muted hover:border-sky-400/40"
                }`}
                style={condition ? { backgroundColor: color, color: textOn(color!) } : undefined}
              />
            )}
            {!hideSeason && <SeasonTag itemId={item.id} tag={item.seasonTag} className="rounded-full border border-transparent px-2.5 py-0.5 text-[0.6875rem]" />}
            {showStanding && state !== "ok" && <ListPill color={STANDING[state].color}>{STANDING[state].label(formatStock(gap, item.sheet))}</ListPill>}
          </span>
        ) : (
          <>
            {location && !rawStock && <ListPill><Icon name="map" className="inline h-3.5 w-3.5" /></ListPill>}
            {condition && <ListPill color={conditionColor(condition.color)}>{condition.label}</ListPill>}
            {!hideSeason && <SeasonTag itemId={item.id} tag={item.seasonTag} className="rounded-full border border-transparent px-2.5 py-0.5 text-[0.6875rem]" />}
            {showStanding && state !== "ok" && <ListPill color={STANDING[state].color}>{STANDING[state].label(formatStock(gap, item.sheet))}</ListPill>}
          </>
        )
      }
      onOpen={() => openItem(item.id, item)}
      selected={selected}
      onToggleSelect={onToggleSelect}
    />
  );
}
