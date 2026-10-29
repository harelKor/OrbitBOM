"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sendItemToReleased, setItemLocation } from "@/app/(app)/inventory/actions";
import { textOn } from "@/components/bom/options";
import { formatPrice, setCurrency, useCurrency } from "@/components/cots/currency";
import { NoteCloud } from "@/components/bom/NoteCloud";
import { Popover } from "@/components/bom/Popover";
import { pushQuery } from "@/components/ui/CategoryBoxes";
import { CheckBadge } from "@/components/ui/CheckBadge";
import { Icon } from "@/components/ui/Icon";
import { softStatusTint } from "@/components/ui/statusTint";
import { getCategory } from "@/lib/inventory/categories";
import { hasSeasonNeed, missing, neededFor, orderHref, standing, type NeedView, type Standing } from "@/lib/inventory/season";
import { SHEET_PIECES, formatStock, parseStock } from "@/lib/inventory/stock";
import { useCan, useEditMode } from "@/components/shell/ModeContext";
import { useInventoryPopup } from "./InventoryPopup";
import { LocationPicker } from "./LocationPicker";
import type { InvCategory, Item, Location } from "./types";

// Seeded conditions carry a colour name (FRCBOM's); ones added since carry a hex colour.
const NAMED: Record<string, string> = { emerald: "#10b981", amber: "#f59e0b", rose: "#f43f5e", sky: "#0ea5e9", slate: "#64748b", violet: "#8b5cf6" };
// The Short views' card colours, the BOM's: Reproduction red, the Order List's orange, In Stock green.
const TINT: Record<Standing, string> = { short: "Reproduction", ordered: "In Order List", ok: "In Stock" };

// Every item with a Season need (a robots need in the Robots view) wears its standing on every
// page: red short, orange on order, green covered. Without one it keeps the plain card, unless
// it's on order (Harel, 2026-10-28).
export function standingTint(item: Item, view: NeedView) {
  const state = standing(item, view);
  const needed = view === "robots" ? neededFor(item, view) != null : hasSeasonNeed(item);
  return needed || state === "ordered" ? softStatusTint(TINT[state]) : undefined;
}

export const conditionColor = (color: string) => NAMED[color] ?? color;

// An item's name: like a COTS part, it opens the product's page when the item has a link
// (light blue, a ▾ to pick when there are several); otherwise it opens the item's window.
export function ProductName({ item, className = "", wrap = false }: { item: Pick<Item, "id" | "name" | "cotsLinks">; className?: string; wrap?: boolean }) {
  const { openItem } = useInventoryPopup();
  const [first, ...more] = item.cotsLinks;
  const fit = wrap ? "line-clamp-2 break-words" : "truncate";
  if (!first)
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openItem(item.id);
        }}
        className={`min-w-0 text-left text-fg hover:text-accent ${fit} ${className}`} title={item.name}>
        {item.name}
      </button>
    );
  return (
    <span className={`flex min-w-0 items-center gap-1 ${className}`} onClick={(e) => e.stopPropagation()}>
      <a href={first.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={`min-w-0 ${fit} text-sky-600 underline-offset-2 hover:underline dark:text-sky-400`} title={`${item.name} · ${first.site || hostOf(first.url)}`}>
        {item.name}
      </a>
      {more.length > 0 && (
        <Popover hideCaret triggerClassName="shrink-0 text-xs text-sky-600" trigger={<span aria-label="Other product links">▾</span>}>
          {() => (
            <ul className="space-y-1 p-1 text-sm">
              {item.cotsLinks.map((l) => (
                <li key={l.url}>
                  <a href={l.url} target="_blank" rel="noreferrer" className="block truncate rounded-md px-2 py-1.5 text-sky-600 hover:bg-raised">
                    {l.site || hostOf(l.url)}
                    {l.priceUsd != null && <span className="ml-2 font-mono text-xs text-emerald-600 tabular-nums">${l.priceUsd.toFixed(2)}</span>}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Popover>
      )}
    </span>
  );
}

// An inventory item as a compact 4:3 card, like the part cards: the picture (its product photo,
// else a linked part's Onshape thumbnail, else the category's picture) with the category,
// condition and location tags on it (category and condition open their page, the location filters
// the page in place), big red − / green + and the count
// (tap it to type the real count) over what's needed ("3 / 6": the view's need, the bigger of the
// season's and the robots' elsewhere), then the name and how the robots use it. The left edge
// takes the condition's colour. A short item gets a cart on its picture that sends what's missing
// to Released; once it's on order the cart and the card turn orange and the cart opens that COTS
// card. The card is washed red, orange or green by its standing. Anywhere else on the card opens the
// item's window; a linked name opens the product. With onToggleSelect (the page's Move / Delete),
// a tap anywhere selects the card instead. hideCategory drops the category tag inside a category.
export function ItemCard({
  item,
  categories,
  condition,
  location,
  locations,
  view = "any",
  onStep,
  onCount,
  hideCategory = false,
  selected,
  onToggleSelect,
}: {
  item: Item;
  hideCategory?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  view?: NeedView;
  categories: InvCategory[];
  condition?: { id: string; label: string; color: string };
  location?: { id: string; name: string };
  // With every location, the card's 📍 tag opens the workshop map window.
  locations?: Location[];
  onStep: (delta: number) => void;
  onCount: (amount: number) => void;
}) {
  const work = useCan("work");
  const { openItem } = useInventoryPopup();
  const category = getCategory(categories, item.category);
  const short = item.usage?.short ?? 0;
  const usedBy = item.usage?.parts.length ?? 0;
  const needed = neededFor(item, view);
  const gap = missing(item, view);
  const tinted = standingTint(item, view);
  const color = condition ? conditionColor(condition.color) : undefined;
  const picture = item.thumbUrl ?? category?.imageUrl ?? null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  // The location pill moves the item in Edit (any team's Edit toggle).
  const edit = useEditMode();
  const [movingLocation, startLocation] = useTransition();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openItem(item.id, item)}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && openItem(item.id, item)}
      aria-label={`Open ${item.name}`}
      className="card-interactive group flex cursor-pointer flex-col border-l-4 text-sm"
      style={{ ...tinted, ...(color && { borderLeftColor: color }) }}
    >
      {onToggleSelect && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          aria-pressed={!!selected}
          aria-label={selected ? `Deselect ${item.name}` : `Select ${item.name}`}
          className={`absolute inset-0 z-20 flex cursor-pointer items-start justify-end rounded-[inherit] p-2 active:scale-[0.98] ${selected ? "ring-2 ring-sky-400" : ""}`}
        >
          <CheckBadge checked={!!selected} />
        </button>
      )}
      <div className="thumb-well relative flex aspect-[4/3] items-center justify-center">
        {picture ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
          <img src={picture} alt="" loading="lazy" className={`h-full w-full object-contain p-3 ${item.thumbUrl ? "" : "opacity-60"}`} />
        ) : (
          <span className="flex flex-col items-center gap-1 text-subtle">
            <Icon name="box" className="h-10 w-10" />
            <span className="text-[11px]">{category?.label}</span>
          </span>
        )}
        {item.note && <NoteCloud note={item.note} raised />}
      </div>
      <div className="card-overlay absolute top-2 left-2 flex max-w-[60%] flex-wrap gap-1">
        {category && !hideCategory && (
          <Link href={`/inventory/c/${category.id}`} onClick={stop} className="truncate rounded-full bg-[#111318]/85 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-accent">
            {category.label}
          </Link>
        )}
        {condition && (
          <Link
            href={`/inventory/condition/${condition.id}`}
            onClick={stop}
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold hover:brightness-110"
            style={{ background: color, color: textOn(color!) }}
          >
            {condition.label}
          </Link>
        )}
      </div>
      <div className="card-overlay absolute top-2 right-2 flex max-w-[38%] flex-col items-end gap-1">
        {(gap > 0 || item.openOrder) && <CartButton item={item} gap={gap} />}
        {location && locations ? (
          // Opens the workshop map with this item's spot lit: Edit mode moves the item to the pin
          // tapped, View mode can filter the page to it (Harel, 2026-10-28).
          <span onClick={stop} className="max-w-full">
            <LocationPicker
              locations={locations}
              value={item.locationId ?? location.id}
              readOnly={!edit}
              onChange={(id) =>
                startLocation(async () => {
                  await setItemLocation(item.id, id);
                })
              }
              disabled={movingLocation}
              ariaLabel={`Location: ${location.name}`}
              className="block max-w-full truncate rounded-full border border-line bg-surface/90 px-2 py-0.5 text-[11px] font-semibold text-fg-2 backdrop-blur-md hover:border-accent hover:text-accent active:scale-[0.98] disabled:opacity-60"
              footer={(close) => (
                <button
                  type="button"
                  className="btn min-h-9 text-xs active:scale-[0.98]"
                  onClick={() => {
                    close();
                    pushQuery({ loc: location.id });
                  }}
                >
                  Show everything at {location.name}
                </button>
              )}
            >
              📍 {location.name}
            </LocationPicker>
          </span>
        ) : (
          location && (
            // Filters the page to this location in place.
            <button
              type="button"
              onClick={(e) => {
                stop(e);
                pushQuery({ loc: location.id });
              }}
              className="max-w-full truncate rounded-full border border-line bg-surface/90 px-2 py-0.5 text-[11px] font-semibold text-fg-2 backdrop-blur-md hover:border-accent hover:text-accent active:scale-[0.98]"
            >
              📍 {location.name}
            </button>
          )
        )}
      </div>

      <div className="card-overlay -mt-12 flex items-center justify-between gap-2 px-2 pb-2" onClick={stop}>
        {work && (<button
          type="button"
          onClick={() => onStep(-1)}
          disabled={item.inStock < 1}
          className="press z-10 flex h-11 w-11 items-center justify-center rounded-md bg-rose-500 text-xl font-bold text-white shadow-sm hover:bg-rose-400 disabled:opacity-30"
          aria-label={item.sheet ? "One sheet less" : "One less"}
        >
          −
        </button>)}
        <span className="z-10 flex items-center gap-1 rounded-full bg-[#111318]/80 px-2.5 py-1 font-mono text-xs font-semibold whitespace-nowrap text-white tabular-nums">
          <span className={gap > 0 ? "text-rose-300" : undefined}>
            <CountBox item={item} onCount={onCount} />
          </span>
          {needed != null && <span className="text-white/70">/ {formatStock(needed, item.sheet)}</span>}
          {item.sheet && <PieceStepper onStep={onStep} max={item.inStock} />}
        </span>
        {work && (<button
          type="button"
          onClick={() => onStep(1)}
          className="press z-10 flex h-11 w-11 items-center justify-center rounded-md bg-emerald-500 text-xl font-bold text-white shadow-sm hover:bg-emerald-400"
          aria-label={item.sheet ? "One sheet more" : "One more"}
        >
          +
        </button>)}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 p-3 pt-2">
        <ProductName item={item} wrap className="text-[17px] leading-snug font-semibold" />
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px]">
          {usedBy > 0 && (
            <span
              className={`rounded-full border px-2 py-0.5 font-semibold ${
                short ? "border-amber-500/60 text-amber-600 dark:text-amber-400" : "border-emerald-500/60 text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {usedBy} part{usedBy === 1 ? "" : "s"}
              {!item.sheet && (short ? ` · ${short} short` : " · covered")}
            </span>
          )}
          {item.cotsLinks[0] && <span className="truncate rounded-full bg-raised px-2 py-0.5 text-fg-2">{item.cotsLinks[0].site || hostOf(item.cotsLinks[0].url)}</span>}
          {item.price != null && <ItemPrice price={item.price} />}
        </div>
      </div>
    </div>
  );
}

// An item's price for one, in dollars or shekels, with the same $ / ₪ switch as the COTS cards
// (one switch for every price in this browser).
export function ItemPrice({ price, suffix = "" }: { price: number; suffix?: string }) {
  const currency = useCurrency();
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
        {formatPrice(price, currency)}
        {suffix}
      </span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setCurrency(currency === "usd" ? "ils" : "usd");
        }}
        className="press rounded-full border border-line-strong px-1.5 text-[11px] font-semibold text-muted hover:border-emerald-500/60 hover:text-emerald-500 active:scale-[0.98]"
        aria-label={currency === "usd" ? "Show in shekels" : "Show in dollars"}
        title={currency === "usd" ? "Show in shekels" : "Show in dollars"}
      >
        {currency === "usd" ? "₪" : "$"}
      </button>
    </span>
  );
}

// The cart on a card's picture. Short with nothing on order: sends what's missing to Released.
// On order: orange, and opens that COTS card.
export function CartButton({ item, gap }: { item: Item; gap: number }) {
  const work = useCan("work");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const order = item.openOrder;
  const label = order ? `${order.status}: open it on the COTS page` : `Send ${formatStock(gap, false)} to Released`;
  if (!order && !work) return null;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        if (order) return router.push(orderHref(order));
        start(async () => {
          setError(null);
          const r = await sendItemToReleased(item.id);
          if (r.error) setError(r.error);
        });
      }}
      title={error ?? label}
      aria-label={label}
      className={`press flex h-9 w-9 items-center justify-center rounded-full border shadow-sm backdrop-blur-md transition-colors duration-150 active:scale-[0.98] disabled:opacity-60 ${
        order ? "border-amber-300 bg-amber-500 text-white hover:bg-amber-400" : error ? "border-rose-400 bg-rose-500/80 text-white" : "border-white/40 bg-[#0D111A]/60 text-white hover:border-sky-400/60 hover:text-sky-300"
      }`}
    >
      <Icon name="cart" className={`h-4.5 w-4.5 ${pending ? "animate-pulse" : ""}`} />
    </button>
  );
}

// The count on a card or in the item window: tap it to type the real count. Saving moves the
// stock by the difference (a "Counted" move), so the history shows "Set to 12 (was 9)".
export function CountBox({ item, onCount, big = false }: { item: Pick<Item, "inStock" | "sheet">; onCount: (amount: number) => void; big?: boolean }) {
  const work = useCan("work");
  const [text, setText] = useState<string | null>(null);
  const done = () => {
    const n = text === null ? null : parseStock(text, item.sheet);
    if (n != null && n >= 0 && Math.abs(n - item.inStock) > 1e-9) onCount(n);
    setText(null);
  };
  if (!work) return <span className={big ? "text-2xl" : ""}>{formatStock(item.inStock, item.sheet)}</span>;
  if (text === null)
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setText(formatStock(item.inStock, item.sheet));
        }}
        className={`rounded px-0.5 underline decoration-dotted decoration-white/40 underline-offset-4 hover:decoration-current ${big ? "text-2xl" : ""}`}
        title="Type the real count"
        aria-label="Type the real count"
      >
        {formatStock(item.inStock, item.sheet)}
      </button>
    );
  return (
    <input
      autoFocus
      value={text}
      inputMode={item.sheet ? "text" : "decimal"}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === "Enter") done();
        if (e.key === "Escape") setText(null);
      }}
      aria-label="Real count"
      className={`rounded bg-white px-1 text-center text-fg outline-none ${big ? "w-24 text-2xl" : "w-14"}`}
    />
  );
}

// A sheet item's pieces: add or take ¼ ⅓ ½ ⅔ ¾ of a sheet.
export function PieceStepper({ onStep, max }: { onStep: (delta: number) => void; max: number }) {
  const work = useCan("work");
  if (!work) return null;
  return (
    <Popover hideCaret align="right" triggerClassName="ml-1 rounded-full bg-white/20 px-1.5 text-[10px] hover:bg-white/30" trigger={<span>pieces ▾</span>}>
      {(close) => (
        <div className="space-y-1.5 p-1 text-sm">
          {(["add", "take"] as const).map((way) => (
            <div key={way} className="flex items-center gap-1">
              <span className="w-10 text-[11px] font-semibold text-subtle">{way === "add" ? "Add" : "Take"}</span>
              {SHEET_PIECES.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled={way === "take" && p.value > max + 1e-9}
                  onClick={() => {
                    onStep(way === "add" ? p.value : -p.value);
                    close();
                  }}
                  className={`press rounded-md px-2.5 py-1.5 font-semibold text-white disabled:opacity-30 ${way === "add" ? "bg-emerald-500 hover:bg-emerald-400" : "bg-rose-500 hover:bg-rose-400"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
