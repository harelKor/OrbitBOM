"use client";

import { useSyncExternalStore } from "react";
import { COTS_IN_STOCK } from "@/config/cots";
import type { SaveFn } from "@/components/bom/fields";
import { Popover } from "@/components/bom/Popover";
import type { CardPart, Shelf } from "@/components/bom/types";
import { useInventoryPopup } from "@/components/inventory/InventoryPopup";
import { useEditMode } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { formatStock } from "@/lib/inventory/stock";
import { computeStatus } from "@/lib/status";

const pill = "press inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold";
const REASONS = { onshape: "the same Onshape part", link: "the same product page", name: "the same name" } as const;

// A COTS card's link to the team inventory: how much of it the shelf covers and how many to
// order, or the item it most likely is. Linking it to a new item happens in the part's details window.
export function ShelfPill({ part, shelf, save }: { part: CardPart; shelf: Shelf | null; save: SaveFn }) {
  const edit = useEditMode();
  const { openItem } = useInventoryPopup();
  if (shelf) {
    const missing = Math.max(0, part.quantity - shelf.covered);
    const tone = shelf.sheet ? "border-line-strong text-fg-2" : missing ? "border-amber-500/60 text-amber-600 dark:text-amber-400" : "border-emerald-500/60 text-emerald-600 dark:text-emerald-400";
    return (
      <Popover
        hideCaret
        triggerClassName="min-w-0 max-w-full"
        trigger={
          <span className={`${pill} ${tone}`} title={shelf.itemName}>
            <Icon name="box" className="h-3 w-3 shrink-0" />
            <span className="font-mono tabular-nums">{formatStock(shelf.inStock, shelf.sheet)}</span>
            <span className="truncate">{shelf.sheet ? "sheets" : "on shelf"}</span>
            {!shelf.sheet && (missing ? <span className="font-mono tabular-nums">· order {missing}</span> : <span>· covered</span>)}
          </span>
        }
      >
        {(close) => (
          <div className="w-64 space-y-2 p-1 text-sm">
            <div className="text-[11px] font-semibold text-subtle">Inventory item</div>
            <div className="font-semibold break-words text-fg">{shelf.itemName}</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
              <dt className="text-muted">On the shelf</dt>
              <dd className="text-right font-mono tabular-nums">{formatStock(shelf.inStock, shelf.sheet)}</dd>
              {!shelf.sheet && (
                <>
                  <dt className="text-muted">All robots need</dt>
                  <dd className="text-right font-mono tabular-nums">{shelf.need}</dd>
                  <dt className="text-muted">Covers this part</dt>
                  <dd className="text-right font-mono tabular-nums">
                    {shelf.covered}/{part.quantity}
                  </dd>
                  <dt className="text-muted">Free</dt>
                  <dd className="text-right font-mono tabular-nums">{shelf.free}</dd>
                </>
              )}
            </dl>
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  close();
                  openItem(shelf.itemId);
                }}
                className="press text-xs font-medium text-accent hover:underline"
              >
                Open item →
              </button>
              {edit && (
                <button
                  type="button"
                  onClick={() => {
                    save({ inventoryItemId: null });
                    close();
                  }}
                  className="press text-xs font-medium text-rose-600 hover:underline"
                >
                  Unlink
                </button>
              )}
            </div>
          </div>
        )}
      </Popover>
    );
  }

  const suggestion = part.shelfSuggestion;
  if (suggestion)
    return (
      <Popover
        hideCaret
        triggerClassName="min-w-0 max-w-full"
        trigger={
          <span className={`${pill} border-dashed border-accent/60 text-accent`} title={`Is this ${suggestion.itemName}?`}>
            <Icon name="box" className="h-3 w-3 shrink-0" />
            <span className="truncate">Link to {suggestion.itemName}?</span>
          </span>
        }
      >
        {(close) => (
          <div className="w-64 space-y-2 p-1 text-sm">
            <p className="text-xs text-muted">
              The inventory has <span className="font-semibold text-fg">{suggestion.itemName}</span> (
              <span className="font-mono tabular-nums">{formatStock(suggestion.inStock, suggestion.sheet)}</span> on the shelf), with {REASONS[suggestion.reason]}.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={close}>
                Not this
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  save({ inventoryItemId: suggestion.itemId });
                  close();
                }}
              >
                Link
              </button>
            </div>
          </div>
        )}
      </Popover>
    );

  return null;
}

// Parts whose "the shelf covers this" suggestion was dismissed, remembered in this browser.
const DISMISSED_KEY = "orbit-shelf-dismissed";
const listeners = new Set<() => void>();
let dismissedIds: Set<string> | null = null;

function readDismissed() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]"));
  } catch {
    return new Set<string>();
  }
}

function dismiss(id: string) {
  dismissedIds = new Set([...(dismissedIds ?? readDismissed()), id]);
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissedIds].slice(-500)));
  } catch {
    // Private windows may refuse; it stays hidden for this page.
  }
  listeners.forEach((l) => l());
}

function useDismissed(id: string) {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (dismissedIds ??= readDismissed()).has(id),
    () => true,
  );
}

// The card's suggestion when the shelf already covers a part that isn't In Stock yet (Harel: a
// suggestion, never automatic). Dismissing hides it in this browser.
export function ShelfCoversPrompt({ part, shelf, save }: { part: CardPart; shelf: Shelf | null; save: SaveFn }) {
  const dismissed = useDismissed(part.id);
  if (!shelf || shelf.sheet || dismissed || shelf.covered < Math.max(part.quantity, 1) || computeStatus(part) === COTS_IN_STOCK) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/10 px-2 py-1.5 text-xs">
      <span className="min-w-0 flex-1 text-fg-2">
        The shelf has <span className="font-mono font-semibold tabular-nums">{part.quantity}</span> for this. Mark In Stock?
      </span>
      <button type="button" onClick={() => save({ status: COTS_IN_STOCK })} className="press rounded-md bg-emerald-600 px-2 py-0.5 font-semibold text-white hover:bg-emerald-500">
        In Stock
      </button>
      <button
        type="button"
        onClick={() => dismiss(part.id)}
        className="press rounded p-0.5 text-subtle hover:text-fg"
        aria-label="Not now"
      >
        <Icon name="close" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
