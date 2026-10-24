"use client";

import Link from "next/link";
import { useState } from "react";
import { COTS_IN_STOCK, ORDER_STATUSES } from "@/config/cots";
import { textOn } from "@/components/bom/options";
import { Popover } from "@/components/bom/Popover";
import { Icon } from "@/components/ui/Icon";
import { getCategory } from "@/lib/inventory/categories";
import { SHEET_PIECES, formatStock, parseStock } from "@/lib/inventory/stock";
import { useInventoryPopup } from "./InventoryPopup";
import type { InvCategory, Item } from "./types";

// Seeded conditions carry a colour name (FRCBOM's); ones added since carry a hex colour.
const NAMED: Record<string, string> = { emerald: "#10b981", amber: "#f59e0b", rose: "#f43f5e", sky: "#0ea5e9", slate: "#64748b", violet: "#8b5cf6" };
const ORDERING = ORDER_STATUSES.filter((s) => s !== COTS_IN_STOCK) as string[];

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
// condition and location tags on it (each opens its page), big red − / green + and the count
// (tap it to type the real count), then the name and how the robots use it. The left edge takes
// the condition's colour. Anywhere else on the card opens the item's window; a linked name opens
// the product.
export function ItemCard({
  item,
  categories,
  condition,
  location,
  onStep,
  onCount,
}: {
  item: Item;
  categories: InvCategory[];
  condition?: { id: string; label: string; color: string };
  location?: { id: string; name: string };
  onStep: (delta: number) => void;
  onCount: (amount: number) => void;
}) {
  const { openItem } = useInventoryPopup();
  const category = getCategory(categories, item.category);
  const need = item.usage?.need ?? 0;
  const short = item.usage?.short ?? 0;
  const usedBy = item.usage?.parts.length ?? 0;
  // A COTS part of the item is on the Order List (ordered, seen or on its way).
  const ordering = !!item.usage?.parts.some((p) => p.status && ORDERING.includes(p.status));
  const color = condition ? conditionColor(condition.color) : undefined;
  const picture = item.thumbUrl ?? category?.imageUrl ?? null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => openItem(item.id, item)}
      onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && openItem(item.id, item)}
      aria-label={`Open ${item.name}`}
      className="card-interactive group flex cursor-pointer flex-col border-l-4 text-sm"
      style={color ? { borderLeftColor: color } : undefined}
    >
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
      </div>
      <div className="absolute top-2 left-2 flex max-w-[60%] flex-wrap gap-1">
        {category && (
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
      <div className="absolute top-2 right-2 flex max-w-[38%] flex-col items-end gap-1">
        {ordering && (
          <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold whitespace-nowrap text-amber-950 shadow-sm" title="A COTS part of this item is on the Order List">
            Ordering
          </span>
        )}
        {location && (
          <Link
            href={`/inventory/location/${location.id}`}
            onClick={stop}
            className="max-w-full truncate rounded-full border border-line bg-surface/90 px-2 py-0.5 text-[11px] font-semibold text-fg-2 backdrop-blur-md hover:border-accent hover:text-accent"
          >
            📍 {location.name}
          </Link>
        )}
      </div>

      <div className="-mt-12 flex items-center justify-between gap-2 px-2 pb-2" onClick={stop}>
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={item.inStock < 1}
          className="press z-10 flex h-11 w-11 items-center justify-center rounded-md bg-rose-500 text-xl font-bold text-white shadow-sm hover:bg-rose-400 disabled:opacity-30"
          aria-label={item.sheet ? "One sheet less" : "One less"}
        >
          −
        </button>
        <span className="z-10 flex items-center gap-1 rounded-full bg-[#111318]/80 px-2.5 py-1 font-mono text-xs font-semibold whitespace-nowrap text-white tabular-nums">
          <CountBox item={item} onCount={onCount} />
          {item.sheet ? " sheets" : need > 0 ? <span className="text-white/70">/ need {need}</span> : " in stock"}
          {item.sheet && <PieceStepper onStep={onStep} max={item.inStock} />}
        </span>
        <button
          type="button"
          onClick={() => onStep(1)}
          className="press z-10 flex h-11 w-11 items-center justify-center rounded-md bg-emerald-500 text-xl font-bold text-white shadow-sm hover:bg-emerald-400"
          aria-label={item.sheet ? "One sheet more" : "One more"}
        >
          +
        </button>
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
          {item.price != null && <span className="font-mono text-emerald-600 tabular-nums">${item.price.toFixed(2)}</span>}
        </div>
      </div>
    </div>
  );
}

// The count on a card or in the item window: tap it to type the real count. Saving moves the
// stock by the difference (a "Counted" move), so the history shows "Set to 12 (was 9)".
export function CountBox({ item, onCount, big = false }: { item: Pick<Item, "inStock" | "sheet">; onCount: (amount: number) => void; big?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const done = () => {
    const n = text === null ? null : parseStock(text, item.sheet);
    if (n != null && n >= 0 && Math.abs(n - item.inStock) > 1e-9) onCount(n);
    setText(null);
  };
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
