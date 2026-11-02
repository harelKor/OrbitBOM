"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { settleLinkSuggestion } from "@/app/(app)/parts-actions";
import { COTS_IN_STOCK } from "@/config/cots";
import type { SaveFn } from "@/components/bom/fields";
import { Popover } from "@/components/bom/Popover";
import type { CardPart, Shelf } from "@/components/bom/types";
import { useInventoryPopup } from "@/components/inventory/InventoryPopup";
import { useCan } from "@/components/shell/ModeContext";
import { Icon } from "@/components/ui/Icon";
import { formatStock } from "@/lib/inventory/stock";
import { computeStatus } from "@/lib/status";

const pill = "press inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold";
const REASONS = { onshape: "the same Onshape part", link: "the same product page", name: "the same name", review: "a link waiting in To Review" } as const;

// A COTS card's link to the team inventory: how much of it the shelf covers and how many to
// order, or the item it most likely is. Linking it to a new item happens in the part's details window.
export function ShelfPill({ part, shelf, save }: { part: CardPart; shelf: Shelf | null; save: SaveFn }) {
  const edit = useCan("work");
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

  // The suggestion sits on the thumbnail as the Link tag (LinkTag) for anyone who can link.
  const suggestion = edit ? null : part.shelfSuggestion;
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
              {edit && <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  save({ inventoryItemId: suggestion.itemId });
                  close();
                }}
              >
                Link
              </button>}
            </div>
          </div>
        )}
      </Popover>
    );

  return null;
}

// The thumbnail's Link tag: the inventory item auto-link (or a member's Claude) suggested for a
// part with no item, or the card's own guess. Link links the part to it (and takes it off To
// Review); ✕ rejects it so it isn't suggested again. Only for those who can link.
export function LinkTag({ part, save }: { part: CardPart; save: SaveFn }) {
  const work = useCan("work");
  const [gone, setGone] = useState(false);
  const [, startTransition] = useTransition();
  const s = part.shelfSuggestion;
  if (!work || !s || part.inventoryItemId || gone) return null;
  const ids = part.memberIds ?? [part.id];
  const why = s.pending ? "Suggested link, waiting in To Review" : `Matched by ${REASONS[s.reason]}`;
  return (
    <span className="flex max-w-full min-w-0 items-center overflow-hidden rounded-full border border-accent/60 bg-surface/90 text-[11px] font-semibold text-accent shadow-sm backdrop-blur-md">
      <button
        type="button"
        onClick={() => {
          setGone(true);
          save({ inventoryItemId: s.itemId });
          if (s.pending) startTransition(() => void settleLinkSuggestion(ids, s.itemId, true));
        }}
        className="press flex min-w-0 items-center gap-1 py-0.5 pr-1 pl-2 hover:bg-accent hover:text-white"
        title={`Link to ${s.itemName} (${formatStock(s.inStock, s.sheet)} on the shelf). ${why}.`}
        aria-label={`Link to ${s.itemName}`}
      >
        <Icon name="link" className="h-3 w-3 shrink-0" />
        <span className="truncate">Link: {s.itemName}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          setGone(true);
          startTransition(() => void settleLinkSuggestion(ids, s.itemId, false));
        }}
        className="press flex shrink-0 items-center self-stretch border-l border-accent/40 px-1 text-subtle hover:bg-rose-600 hover:text-white"
        title={`Not ${s.itemName}: don't suggest it again`}
        aria-label={`Reject the link to ${s.itemName}`}
      >
        <Icon name="close" className="h-3 w-3" />
      </button>
    </span>
  );
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
// suggestion, never automatic). A card Inventory sent to refill the shelf asks once the shelf has
// the item's whole need (its season count). A compact pill so it never makes the card taller: a tap
// marks the part In Stock, ✕ dismisses it in this browser. Cards and List rows both show it.
// The count is the whole shelf against what this part needs ("19/1"); a refill card counts it
// against the item's whole need. On a card it sits on the thumbnail's top-right (`overlay`).
export function ShelfCoversPrompt({ part, shelf, save, overlay = false }: { part: CardPart; shelf: Shelf | null; save: SaveFn; overlay?: boolean }) {
  const work = useCan("work");
  const dismissed = useDismissed(part.id);
  if (!work || !shelf || dismissed || computeStatus(part) === COTS_IN_STOCK) return null;
  if (shelf.restock ? !shelf.met : shelf.sheet || shelf.covered < Math.max(part.quantity, 1)) return null;
  const count = `${formatStock(shelf.inStock, shelf.sheet)}/${shelf.restock ? formatStock(shelf.total || part.quantity) : part.quantity}`;
  const why = shelf.restock ? `The shelf has ${count}, all that's needed. Mark In Stock` : `The shelf has ${part.quantity} for this. Mark In Stock`;
  return (
    <span
      className={`inline-flex max-w-full min-w-0 shrink-0 items-center overflow-hidden rounded-full border border-emerald-500/60 text-[11px] ${
        overlay ? "bg-surface/90 shadow-sm backdrop-blur-md" : "bg-emerald-500/10"
      } font-semibold text-emerald-600 dark:text-emerald-400`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          save({ status: COTS_IN_STOCK, fromShelfPrompt: true });
        }}
        className="press flex min-w-0 items-center gap-1 py-0.5 pr-1 pl-2 hover:bg-emerald-600 hover:text-white"
        title={why}
        aria-label={why}
      >
        <span aria-hidden>✓</span>
        <span className="truncate">
          <span className="sm:hidden">Stock?</span>
          <span className="hidden sm:inline">In Stock?</span>
        </span>
        <span className="hidden font-mono tabular-nums sm:inline">({count})</span>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          dismiss(part.id);
        }}
        className="press flex shrink-0 items-center self-stretch border-l border-emerald-500/40 px-1 text-subtle hover:bg-raised hover:text-fg"
        aria-label="Not now"
        title="Not now"
      >
        <Icon name="close" className="h-3 w-3" />
      </button>
    </span>
  );
}
