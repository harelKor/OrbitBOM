"use client";

import { StepButton } from "@/components/ui/Stepper";
import { useState, useTransition } from "react";
import { Popover } from "@/components/bom/Popover";
import { Icon } from "@/components/ui/Icon";
import { setItemLocation, setSeasonNeed } from "@/app/(app)/inventory/actions";
import { useCan } from "@/components/shell/ModeContext";
import { CheckBadge } from "@/components/ui/CheckBadge";
import { getCategory } from "@/lib/inventory/categories";
import {
  hasSeasonNeed,
  missing,
  neededFor,
  type NeedView,
} from "@/lib/inventory/season";
import { formatStock, formatStockExact } from "@/lib/inventory/stock";
import {
  CartButton,
  CountBox,
  ItemPrice,
  PieceStepper,
  ProductName,
  conditionColor,
  standingTint,
} from "./ItemCard";
import { useInventoryPopup } from "./InventoryPopup";
import { LocationPicker, PlaceTag } from "./LocationPicker";
import { SeasonTag } from "./SeasonTag";
import { VariantDots, useVariantStep } from "./Variants";
import type { Condition, InvCategory, Item, Location } from "./types";
import { SheetViewport } from "@/components/ui/SheetViewport";

// The Table side of the Cards | Table switch (Harel, 2026-10-27): one row per item, for long
// lists of screws, belts, gears and drills. The count ("3 / 6", like a card), − / +, Needed for
// Season and the cart (beside the name) work in place like on a card, and in Edit mode the
// Location cell is a menu; the row opens the item's window. The item's picture shows at the left
// of its name once the card size slider is big enough (.table-thumb).
export function ItemTable({
  items,
  categories,
  conditions,
  locationOf,
  locations,
  view,
  hideCategory,
  hideSeason = false,
  onStep,
  onCount,
  selected,
  onToggleSelect,
  glowOf,
}: {
  items: Item[];
  categories: InvCategory[];
  conditions: Condition[];
  locations: Location[];
  locationOf: (i: Item) => string | null;
  view: NeedView;
  hideCategory: boolean;
  hideSeason?: boolean; // filtered to one season: the tag would be the same on every row
  onStep: (id: string, delta: number, size?: string, variantId?: string) => void;
  onCount: (id: string, amount: number) => void;
  selected: Set<string>;
  onToggleSelect?: (id: string) => void;
  glowOf?: (id: string) => "lit" | "fade" | undefined; // just added: a warm light until the next click
}) {
  const { openItem } = useInventoryPopup();
  const work = useCan("work");
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <SheetViewport id="inventory">
      <table className="data-table inv-table">
        <thead>
          <tr>
            {onToggleSelect && <th aria-label="Select" />}
            <th className="sheet-name">Item</th>
            {!hideCategory && <th>Category</th>}
            <th className="text-center">In stock</th>
            <th>Specs</th>
            <th>Place</th>
            <th className="text-center">Needed for Season</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const category = getCategory(categories, item.category);
            const condition = conditions.find((c) => c.id === item.conditionId);
            const location = locations.find((l) => l.id === locationOf(item));
            const gap = missing(item, view);
            const needed = neededFor(item, view);
            const picture = item.thumbUrl ?? category?.imageUrl ?? null;
            const tint = standingTint(item, view);
            return (
              <tr
                key={item.id}
                onClick={() =>
                  onToggleSelect
                    ? onToggleSelect(item.id)
                    : openItem(item.id, item)
                }
                className="cursor-pointer"
                data-item={item.id}
                data-new={glowOf?.(item.id)}
                style={tint}
              >
                {onToggleSelect && (
                  <td className="w-10">
                    {selected.has(item.id) ? (
                      <CheckBadge checked />
                    ) : (
                      <span className="block h-5 w-5 rounded-full border-2 border-line-strong" />
                    )}
                  </td>
                )}
                <td className="sheet-name">
                  <span className="flex items-center">
                    <span className="table-thumb thumb-well rounded-md">
                      {picture && (
                        // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
                        <img
                          src={picture}
                          alt=""
                          loading="lazy"
                          className={`h-full w-full object-contain p-0.5 ${item.thumbUrl ? "" : "opacity-60"}`}
                        />
                      )}
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      {item.variants?.length ? (
                        <VariantDots variants={item.variants} conditions={conditions} />
                      ) : condition && (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            background: conditionColor(condition.color),
                          }}
                          title={condition.label}
                        />
                      )}
                      <ProductName item={item} className="font-semibold" />
                      {!hideSeason && !item.station && (
                        <span onClick={stop} className="shrink-0">
                          <SeasonTag itemId={item.id} tag={item.seasonTag} />
                        </span>
                      )}
                      {item.note && <NoteButton note={item.note} />}
                      {(gap > 0 || item.openOrder) && (
                        <span onClick={stop} className="shrink-0">
                          <CartButton item={item} gap={gap} />
                        </span>
                      )}
                    </span>
                  </span>
                </td>
                {!hideCategory && (
                  <td className="text-xs whitespace-nowrap text-muted">
                    {category?.label}
                  </td>
                )}
                <td onClick={stop}>
                  <span className="flex items-center justify-center gap-1.5">
                    <VariantSteps item={item} conditions={conditions} show={work && !item.station} onStep={(d, b, v) => onStep(item.id, d, b, v)}>
                    <span
                      className={`min-w-10 text-center font-mono font-semibold tabular-nums ${gap > 0 ? "text-rose-500" : ""}`}
                    >
                      <CountBox
                        item={item}
                        onCount={(n) => onCount(item.id, n)}
                      />
                      {needed != null && (
                        <span className="font-normal text-subtle">
                          {" "}
                          / {formatStock(needed, item.sheet)}
                        </span>
                      )}
                    </span>
                    {item.sheet && (
                      <PieceStepper
                        item={item}
                        onStep={(d, b) => onStep(item.id, d, b)}
                      />
                    )}
                    </VariantSteps>
                  </span>
                </td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    {Object.entries(item.specs).map(([k, v]) => (
                      <span
                        key={k}
                        className="rounded-full bg-raised px-2 py-0.5 font-mono text-[0.6875rem] whitespace-nowrap text-fg-2 tabular-nums"
                      >
                        {v}
                      </span>
                    ))}
                  </span>
                </td>
                {work ? (
                  <td onClick={stop}>
                    <LocationCell
                      item={item}
                      locations={locations}
                      inherited={item.locationId ? null : (location ?? null)}
                    />
                  </td>
                ) : (
                  <td className="text-xs whitespace-nowrap text-muted">
                    {location ? <PlaceTag place={locations.find((l) => l.id === location.id)} places={locations} /> : ""}
                  </td>
                )}
                <td onClick={stop} className="text-center">
                  <SeasonCell item={item} />
                </td>
                <td className="whitespace-nowrap" onClick={stop}>
                  {item.price != null && <ItemPrice price={item.price} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </SheetViewport>
  );
}

// The row's location in Edit mode: picking one moves the item there at once. An item with no
// location of its own shows its group's, as the first choice.
function LocationCell({
  item,
  locations,
  inherited,
}: {
  item: Item;
  locations: Location[];
  inherited: Location | null;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <LocationPicker
      locations={locations}
      value={value ?? item.locationId}
      disabled={pending}
      onChange={(id) => {
        setValue(id ?? "");
        start(async () => {
          const r = await setItemLocation(item.id, id);
          setError(r.error ?? null);
          setValue(null);
        });
      }}
      ariaLabel={`Place of ${item.name}`}
      className={`input min-h-9 w-auto py-1 text-left text-xs active:scale-[0.98] ${error ? "border-rose-500" : ""}`}
    >
      {(() => {
        const at = locations.find((l) => l.id === (value ?? item.locationId));
        return at ? <PlaceTag place={at} places={locations} /> : inherited ? <PlaceTag place={inherited} places={locations} suffix="(group)" /> : "No place";
      })()}
    </LocationPicker>
  );
}

// Needed for Season, typed in the row. Blank or 0 clears it; saves on Enter or leaving the box.
function SeasonCell({ item }: { item: Item }) {
  const work = useCan("work");
  // The exact amount ("2 ¾"), which the box can read back; "~3" would fail to save.
  const current = hasSeasonNeed(item)
    ? formatStockExact(item.seasonNeed!, item.sheet)
    : "";
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const save = () => {
    if (text === null || text.trim() === current) return setText(null);
    const value = text;
    start(async () => {
      const r = await setSeasonNeed(item.id, value);
      setError(r.error ?? null);
      setText(null);
    });
  };
  return (
    <input
      value={text ?? current}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setText(null);
      }}
      disabled={pending || !work}
      inputMode={item.sheet ? "text" : "numeric"}
      placeholder="—"
      title={error ?? undefined}
      aria-label={`Needed for Season: ${item.name}`}
      className={`w-16 rounded-md border bg-surface px-1 py-1 text-center font-mono font-semibold tabular-nums outline-none focus:border-sky-400 ${error ? "border-rose-500" : "border-line-strong"}`}
    />
  );
}

// The note icon next to a row's name: the note opens in a cloud from the icon, without opening
// the item's window.
function NoteButton({ note }: { note: string }) {
  return (
    <span onClick={(e) => e.stopPropagation()} className="shrink-0">
      <Popover
        hideCaret
        triggerClassName="press relative flex h-7 w-7 items-center justify-center rounded-full border border-amber-400/70 bg-amber-50 text-amber-700 hover:border-amber-500 active:scale-[0.98] dark:bg-amber-400/10 dark:text-amber-300"
        trigger={
          <>
            <Icon name="note" className="h-3.5 w-3.5" />
            <span className="sr-only">Show note</span>
          </>
        }
      >
        {() => (
          <div className="max-w-72 rounded-[1.4rem] border-[3px] border-[#111318] bg-[#fff59d] px-3.5 py-2 text-sm leading-snug font-bold break-words whitespace-pre-line text-[#111318] shadow-[3px_4px_0_0_rgba(17,19,24,0.9)]" dir="auto">
            {note}
          </div>
        )}
      </Popover>
    </span>
  );
}

// The row's − count +: an item with variants asks which one moves (components/inventory/Variants.tsx).
function VariantSteps({ item, conditions, show, onStep, children }: { item: Item; conditions: Condition[]; show: boolean; onStep: (delta: number, size?: string, variantId?: string) => void; children: React.ReactNode }) {
  const steps = useVariantStep(item, conditions, onStep);
  return (
    <>
      {steps.chooser}
      {show && <StepButton step={-1} onClick={(e) => steps.step(-1, e)} disabled={item.sheet ? item.inStock <= 0 : item.inStock < 1} label={`One less ${item.name}`} />}
      {children}
      {show && <StepButton step={1} onClick={(e) => steps.step(1, e)} label={`One more ${item.name}`} />}
    </>
  );
}
