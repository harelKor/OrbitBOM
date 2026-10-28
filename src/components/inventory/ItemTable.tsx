"use client";

import { useState, useTransition } from "react";
import { Popover } from "@/components/bom/Popover";
import { Icon } from "@/components/ui/Icon";
import { setItemLocation, setSeasonNeed } from "@/app/(app)/inventory/actions";
import { useEditMode } from "@/components/shell/ModeContext";
import { CheckBadge } from "@/components/ui/CheckBadge";
import { statusTint } from "@/components/ui/statusTint";
import { getCategory } from "@/lib/inventory/categories";
import {
  hasSeasonNeed,
  missing,
  neededFor,
  standing,
  type NeedView,
} from "@/lib/inventory/season";
import { formatStock } from "@/lib/inventory/stock";
import {
  CartButton,
  CountBox,
  ItemPrice,
  PieceStepper,
  ProductName,
  conditionColor,
} from "./ItemCard";
import { useInventoryPopup } from "./InventoryPopup";
import type { Condition, InvCategory, Item, Location } from "./types";
import { SheetViewport } from "@/components/ui/SheetViewport";

const TINT = {
  short: "Reproduction",
  ordered: "In Order List",
  ok: "In Stock",
} as const;

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
  onStep,
  onCount,
  selected,
  onToggleSelect,
}: {
  items: Item[];
  categories: InvCategory[];
  conditions: Condition[];
  locations: Location[];
  locationOf: (i: Item) => string | null;
  view: NeedView;
  hideCategory: boolean;
  onStep: (id: string, delta: number) => void;
  onCount: (id: string, amount: number) => void;
  selected: Set<string>;
  onToggleSelect?: (id: string) => void;
}) {
  const { openItem } = useInventoryPopup();
  const edit = useEditMode();
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <SheetViewport id="inventory" pin={onToggleSelect ? 2 : 1}>
      <table className="data-table inv-table">
        <thead>
          <tr>
            {onToggleSelect && <th aria-label="Select" />}
            <th>Item</th>
            {!hideCategory && <th>Category</th>}
            <th className="text-center">In stock</th>
            <th>Specs</th>
            <th>Location</th>
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
            const state = standing(item, view);
            const tint =
              view !== "any" || state === "ordered"
                ? statusTint(TINT[state])
                : undefined;
            return (
              <tr
                key={item.id}
                onClick={() =>
                  onToggleSelect
                    ? onToggleSelect(item.id)
                    : openItem(item.id, item)
                }
                className="cursor-pointer"
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
                <td className="min-w-56">
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
                      {condition && (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            background: conditionColor(condition.color),
                          }}
                          title={condition.label}
                        />
                      )}
                      <ProductName item={item} className="font-semibold" />
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
                    <button
                      type="button"
                      onClick={() => onStep(item.id, -1)}
                      disabled={item.inStock < 1}
                      className="press flex h-8 w-8 items-center justify-center rounded-md bg-rose-500 font-bold text-white hover:bg-rose-400 active:scale-[0.98] disabled:opacity-30"
                      aria-label={`One less ${item.name}`}
                    >
                      −
                    </button>
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
                        onStep={(d) => onStep(item.id, d)}
                        max={item.inStock}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => onStep(item.id, 1)}
                      className="press flex h-8 w-8 items-center justify-center rounded-md bg-emerald-500 font-bold text-white hover:bg-emerald-400 active:scale-[0.98]"
                      aria-label={`One more ${item.name}`}
                    >
                      +
                    </button>
                  </span>
                </td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    {Object.entries(item.specs).map(([k, v]) => (
                      <span
                        key={k}
                        className="rounded-full bg-raised px-2 py-0.5 font-mono text-[11px] whitespace-nowrap text-fg-2 tabular-nums"
                      >
                        {v}
                      </span>
                    ))}
                  </span>
                </td>
                {edit ? (
                  <td onClick={stop}>
                    <LocationCell
                      item={item}
                      locations={locations}
                      inherited={item.locationId ? null : (location ?? null)}
                    />
                  </td>
                ) : (
                  <td className="text-xs whitespace-nowrap text-muted">
                    {location ? `📍 ${location.name}` : ""}
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
    <select
      value={value ?? item.locationId ?? ""}
      disabled={pending}
      onChange={(e) => {
        const id = e.target.value;
        setValue(id);
        start(async () => {
          const r = await setItemLocation(item.id, id || null);
          setError(r.error ?? null);
          setValue(null);
        });
      }}
      title={error ?? undefined}
      aria-label={`Location: ${item.name}`}
      className={`input min-h-9 w-auto py-1 text-xs ${error ? "border-rose-500" : ""}`}
    >
      <option value="">
        {inherited ? `📍 ${inherited.name} (group)` : "No location"}
      </option>
      {locations.map((l) => (
        <option key={l.id} value={l.id}>
          📍 {l.name}
        </option>
      ))}
    </select>
  );
}

// Needed for Season, typed in the row. Blank or 0 clears it; saves on Enter or leaving the box.
function SeasonCell({ item }: { item: Item }) {
  const current = hasSeasonNeed(item)
    ? formatStock(item.seasonNeed!, item.sheet)
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
      disabled={pending}
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
          <div className="max-w-72 rounded-[1.4rem] border-[3px] border-[#111318] bg-[#fff59d] px-3.5 py-2 text-sm leading-snug font-bold break-words whitespace-pre-line text-[#111318] shadow-[3px_4px_0_0_rgba(17,19,24,0.9)]">
            {note}
          </div>
        )}
      </Popover>
    </span>
  );
}
