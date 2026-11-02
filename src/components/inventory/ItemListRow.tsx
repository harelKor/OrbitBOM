"use client";

import { useTransition } from "react";
import { setItemCondition, setItemLocation } from "@/app/(app)/inventory/actions";
import { textOn } from "@/components/bom/options";
import { useCan } from "@/components/shell/ModeContext";
import { ListPill, ListRow } from "@/components/ui/ListRow";
import { getCategory, specLine } from "@/lib/inventory/categories";
import { hasSeasonNeed, missing, neededFor, standing, type NeedView } from "@/lib/inventory/season";
import { formatStock, isSheetGoods } from "@/lib/inventory/stock";
import { CountBox, PieceStepper, conditionColor, standingTint } from "./ItemCard";
import { LocationPicker } from "./LocationPicker";
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
  const stepBtn = "press flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-lg font-bold text-white shadow-sm active:scale-[0.98] disabled:opacity-30";
  return (
    <ListRow
      data-item={item.id}
      data-new={glow}
      style={standingTint(item, view)}
      picture={item.thumbUrl ?? category?.imageUrl ?? null}
      dimPicture={!item.thumbUrl}
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
          <span className="contents" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            {stepper && (
              <span className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onStep(-1)}
                  disabled={item.sheet ? item.inStock <= 0 : item.inStock < 1}
                  className={`${stepBtn} bg-rose-500 hover:bg-rose-400`}
                  aria-label={sheetWord ? "One sheet less" : "One less"}
                >
                  −
                </button>
                <span className="flex items-center gap-1 rounded-full bg-[#111318]/80 px-2.5 py-1 font-mono text-xs font-semibold whitespace-nowrap text-white tabular-nums">
                  <span className={gap > 0 ? "text-rose-300" : undefined}>
                    <CountBox item={item} onCount={onCount} />
                  </span>
                  {needed != null && <span className="text-white/70">/ {formatStock(needed, item.sheet)}</span>}
                  {item.sheet && <PieceStepper item={item} onStep={onStep} />}
                </span>
                <button type="button" onClick={() => onStep(1)} className={`${stepBtn} bg-emerald-500 hover:bg-emerald-400`} aria-label={sheetWord ? "One sheet more" : "One more"}>
                  +
                </button>
              </span>
            )}
            {locations && (
              <LocationPicker
                locations={locations}
                value={item.locationId ?? location?.id ?? null}
                onChange={(id) =>
                  startSaving(async () => {
                    await setItemLocation(item.id, id);
                  })
                }
                disabled={saving}
                ariaLabel={location ? `Location: ${location.name}` : "Add location"}
                className={`press max-w-full truncate rounded-full border px-2.5 py-0.5 text-[11px] font-medium hover:border-sky-400/40 hover:text-accent active:scale-[0.98] disabled:opacity-60 ${
                  location ? "border-line-strong bg-ink/60 text-fg-2" : "border-dashed border-line-strong text-muted"
                }`}
              >
                {location ? `📍 ${location.name}` : "+ Location"}
              </LocationPicker>
            )}
            {conditions && (
              <select
                value={item.conditionId ?? ""}
                disabled={saving}
                onChange={(e) => {
                  const conditionId = e.target.value || null;
                  startSaving(async () => {
                    await setItemCondition(item.id, conditionId);
                  });
                }}
                aria-label="Condition"
                className={`press max-w-full cursor-pointer appearance-none truncate rounded-full border px-2.5 py-0.5 text-[11px] font-semibold active:scale-[0.98] disabled:opacity-60 ${
                  condition ? "border-transparent hover:brightness-110" : "border-dashed border-line-strong bg-transparent text-muted hover:border-sky-400/40"
                }`}
                style={condition ? { backgroundColor: color, color: textOn(color!) } : undefined}
              >
                <option value="" className="bg-surface text-fg">
                  {condition ? "No condition" : "+ Condition"}
                </option>
                {conditions.map((c) => (
                  <option key={c.id} value={c.id} className="bg-surface text-fg">
                    {c.label}
                  </option>
                ))}
              </select>
            )}
            <SeasonTag itemId={item.id} tag={item.seasonTag} className="rounded-full border border-transparent px-2.5 py-0.5 text-[11px]" />
            {showStanding && <ListPill color={STANDING[state].color}>{STANDING[state].label(formatStock(gap, item.sheet))}</ListPill>}
          </span>
        ) : (
          <>
            {location && <ListPill>📍 {location.name}</ListPill>}
            {condition && <ListPill color={conditionColor(condition.color)}>{condition.label}</ListPill>}
            <SeasonTag itemId={item.id} tag={item.seasonTag} className="rounded-full border border-transparent px-2.5 py-0.5 text-[11px]" />
            {showStanding && <ListPill color={STANDING[state].color}>{STANDING[state].label(formatStock(gap, item.sheet))}</ListPill>}
          </>
        )
      }
      onOpen={() => openItem(item.id, item)}
      selected={selected}
      onToggleSelect={onToggleSelect}
    />
  );
}
