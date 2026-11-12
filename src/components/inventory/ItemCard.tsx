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
import { type PieceBase, canTakePiece, formatStock, formatStockExact, isSheetGoods, parseSize, parseStock, pieceBase, pieceLabel, pieceRatio, pieceRows, sortedRows } from "@/lib/inventory/stock";
import { useCan } from "@/components/shell/ModeContext";
import { useInventoryPopup } from "./InventoryPopup";
import { LocationPicker } from "./LocationPicker";
import { SeasonTag } from "./SeasonTag";
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
  glow,
}: {
  item: Item;
  hideCategory?: boolean;
  glow?: "lit" | "fade"; // just added: a warm light until the next click, then it fades
  selected?: boolean;
  onToggleSelect?: () => void;
  view?: NeedView;
  categories: InvCategory[];
  condition?: { id: string; label: string; color: string };
  location?: { id: string; name: string };
  // With every location, the card's 📍 tag opens the workshop map window.
  locations?: Location[];
  onStep: (delta: number, size?: string) => void;
  onCount: (amount: number) => void;
}) {
  const work = useCan("work");
  const { openItem } = useInventoryPopup();
  const category = getCategory(categories, item.category);
  // Raw stock cards leave out the 📍 tag (Harel, 2026-11-02).
  const rawStock = item.sheet || category?.group === "consumables";
  const needed = neededFor(item, view);
  const gap = missing(item, view);
  const tinted = standingTint(item, view);
  const color = condition ? conditionColor(condition.color) : undefined;
  const picture = item.thumbUrl ?? category?.imageUrl ?? null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const [movingLocation, startLocation] = useTransition();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openItem(item.id, item)}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && openItem(item.id, item)}
      aria-label={`Open ${item.name}`}
      className="card-interactive group flex w-full max-w-full min-w-0 overflow-hidden cursor-pointer flex-col border-l-4 text-sm"
      data-item={item.id}
      data-new={glow}
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
        <SeasonTag itemId={item.id} tag={item.seasonTag} />
      </div>
      <div className="card-overlay absolute top-2 right-2 flex max-w-[38%] flex-col items-end gap-1">
        {(gap > 0 || item.openOrder) && <CartButton item={item} gap={gap} />}
        {rawStock ? null : location && locations ? (
          // Opens the workshop map with this item's spot lit: a team member moves the item to the pin
          // tapped; a member without a team can filter the page to it (Harel, 2026-10-28).
          <span onClick={stop} className="max-w-full">
            <LocationPicker
              locations={locations}
              value={item.locationId ?? location.id}
              readOnly={!work}
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

      {/* As tall as the − / + buttons even without them (no team), or the name slides up under the picture. */}
      <div className="card-overlay -mt-12 flex min-h-13 items-center justify-between gap-2 px-2 pb-2" onClick={stop}>
        {work && (<button
          type="button"
          onClick={() => onStep(-1)}
          disabled={item.sheet ? item.inStock <= 0 : item.inStock < 1}
          className="press z-10 flex h-11 w-11 items-center justify-center rounded-md bg-rose-500 text-xl font-bold text-white shadow-sm hover:bg-rose-400 disabled:opacity-30"
          aria-label={item.sheet && isSheetGoods(category?.label ?? item.name) ? "One sheet less" : "One less"}
        >
          −
        </button>)}
        <span className="z-10 flex items-center gap-1 rounded-full bg-[#111318]/80 px-2.5 py-1 font-mono text-xs font-semibold whitespace-nowrap text-white tabular-nums">
          <span className={gap > 0 ? "text-rose-300" : undefined}>
            <CountBox item={item} onCount={onCount} />
          </span>
          {needed != null && <span className="text-white/70">/ {formatStock(needed, item.sheet)}</span>}
          {item.sheet && <PieceStepper item={item} onStep={onStep} />}
        </span>
        {work && (<button
          type="button"
          onClick={() => onStep(1)}
          className="press z-10 flex h-11 w-11 items-center justify-center rounded-md bg-emerald-500 text-xl font-bold text-white shadow-sm hover:bg-emerald-400"
          aria-label={item.sheet && isSheetGoods(category?.label ?? item.name) ? "One sheet more" : "One more"}
        >
          +
        </button>)}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 p-3 pt-2">
        <ProductName item={item} wrap className="text-[17px] leading-snug font-semibold" />
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px]">
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
// In the item window, `onLeave` closes it on the way to COTS and `onSent` reloads it.
export function CartButton({ item, gap, onLeave, onSent }: { item: Item; gap: number; onLeave?: () => void; onSent?: () => void }) {
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
        if (order) {
          onLeave?.();
          return router.push(orderHref(order));
        }
        start(async () => {
          setError(null);
          const r = await sendItemToReleased(item.id);
          if (r.error) setError(r.error);
          else onSent?.();
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
  if (!work) return <span className={big ? "text-3xl sm:text-4xl" : ""}>{formatStock(item.inStock, item.sheet)}</span>;
  if (text === null)
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setText(formatStockExact(item.inStock, item.sheet));
        }}
        className={`rounded px-0.5 underline decoration-dotted decoration-white/40 underline-offset-4 hover:decoration-current ${big ? "text-3xl sm:text-4xl" : ""}`}
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
      className={`rounded bg-white px-1 text-center text-fg outline-none ${big ? "w-28 text-3xl sm:text-4xl" : "w-14"}`}
    />
  );
}

// A fraction item's pieces: every size it has (presets and custom ones) with how many are on the
// shelf, − takes one, + adds one; a new length or plate size adds one piece of it.
export function PieceStepper({ item, onStep }: { item: Pick<Item, "inStock" | "pieces" | "specs" | "name">; onStep: (delta: number, size?: string) => void }) {
  const work = useCan("work");
  if (!work) return null;
  const stocked = { ...item, sheet: true };
  const base = pieceBase(item.specs, item.name);
  const rows = sortedRows(pieceRows(item.inStock, item.pieces, base), base);
  return (
    <Popover
      hideCaret
      align="right"
      // Bigger on phones so it opens on the first tap in the shop (Harel, 2026-11-05).
      triggerClassName="ml-1 rounded-full bg-white/20 px-1.5 text-[10px] hover:bg-white/30 pointer-coarse:min-h-8 pointer-coarse:px-3 pointer-coarse:text-xs pointer-coarse:font-semibold"
      panelClassName="ring-1 ring-white/15 shadow-lg"
      trigger={<span>pieces ▾</span>}
    >
      {(close) => (
        <div className="flex min-h-0 flex-col">
          <div className="min-h-0 flex-1 divide-y divide-line overflow-y-auto p-1 text-sm">
            {rows.map((row) => {
              const label = pieceLabel(row.size, base);
              const ratio = pieceRatio(row.size, base);
              return (
                <div key={row.size} className="flex items-center gap-2 py-1">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono font-semibold tabular-nums">{label.primary}</span>
                    {label.sub && <span className="ml-1.5 text-xs text-muted">{label.sub}</span>}
                  </span>
                  <span className={`font-mono text-xs font-semibold tabular-nums ${row.count ? "text-accent" : "text-subtle"}`}>×{row.count}</span>
                  <button
                    type="button"
                    disabled={!canTakePiece(stocked, row.size)}
                    onClick={() => {
                      onStep(-ratio, row.size);
                      close();
                    }}
                    aria-label={`Take ${label.primary}`}
                    className="press flex h-9 w-10 shrink-0 items-center justify-center rounded-md bg-rose-500 text-lg font-bold text-white hover:bg-rose-400 active:scale-[0.98] disabled:opacity-30"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onStep(ratio, row.size);
                      close();
                    }}
                    aria-label={`Add ${label.primary}`}
                    className="press flex h-9 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-500 text-lg font-bold text-white hover:bg-emerald-400 active:scale-[0.98]"
                  >
                    +
                  </button>
                </div>
              );
            })}
          </div>
          <NewSize
            base={base}
            label="+ New size"
            onAdd={(size) => {
              onStep(pieceRatio(size, base), size);
              close();
            }}
          />
        </div>
      )}
    </Popover>
  );
}

// A new piece size typed in: a length in mm for tubes and shafts, X × Y for plates. Items with no
// length or sheet size (filament) keep the preset fractions only.
export function NewSize({ base, label, onAdd, bare = false }: { base: PieceBase; label: string; onAdd: (size: string) => void; bare?: boolean }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  if (base.kind === "none") return null;
  const size = parseSize(base.kind === "xy" ? `${a}x${b}` : a, base);
  const add = () => {
    if (!size) return;
    onAdd(size);
    setA("");
    setB("");
  };
  const box = "h-8 min-w-0 rounded-md border border-line bg-raised px-2 font-mono text-sm tabular-nums outline-none focus:border-sky-400/60";
  const keys = (e: React.KeyboardEvent) => e.key === "Enter" && add();
  return (
    <div className={`flex items-center gap-1.5 ${bare ? "" : "border-t border-line p-1 pt-2"}`} onClick={(e) => e.stopPropagation()}>
      <span className="shrink-0 text-xs font-semibold text-subtle">{label}</span>
      {base.kind === "xy" ? (
        <>
          <input value={a} onChange={(e) => setA(e.target.value)} onKeyDown={keys} inputMode="numeric" placeholder="X" aria-label="Width (mm)" className={`${box} w-14`} />
          <span className="text-subtle">×</span>
          <input value={b} onChange={(e) => setB(e.target.value)} onKeyDown={keys} inputMode="numeric" placeholder="Y" aria-label="Length (mm)" className={`${box} w-14`} />
        </>
      ) : (
        <input value={a} onChange={(e) => setA(e.target.value)} onKeyDown={keys} inputMode="numeric" placeholder="Length (mm)" aria-label="Length (mm)" className={`${box} w-24 flex-1`} />
      )}
      <button type="button" disabled={!size} onClick={add} className="press h-8 shrink-0 rounded-md bg-sky-500 px-2.5 text-xs font-semibold text-white hover:bg-sky-400 active:scale-[0.98] disabled:opacity-40">
        Add
      </button>
    </div>
  );
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
