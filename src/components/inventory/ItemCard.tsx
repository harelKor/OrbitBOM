"use client";

import { textOn } from "@/components/bom/options";
import { Popover } from "@/components/bom/Popover";
import { Icon } from "@/components/ui/Icon";
import { getCategory, specLine } from "@/lib/inventory/categories";
import { SHEET_PIECES, formatStock } from "@/lib/inventory/stock";
import { useInventoryPopup } from "./InventoryPopup";
import type { InvCategory, Item } from "./types";

// Seeded conditions carry a colour name (FRCBOM's); ones added since carry a hex colour.
const NAMED: Record<string, string> = { emerald: "#10b981", amber: "#f59e0b", rose: "#f43f5e", sky: "#0ea5e9", slate: "#64748b", violet: "#8b5cf6" };
export const conditionColor = (color: string) => NAMED[color] ?? color;

// An item's name: like a COTS part, it opens the product's page when the item has a link
// (light blue, a ▾ to pick when there are several); otherwise it opens the item's window.
export function ProductName({ item, className = "" }: { item: Pick<Item, "id" | "name" | "cotsLinks">; className?: string }) {
  const { openItem } = useInventoryPopup();
  const [first, ...more] = item.cotsLinks;
  if (!first)
    return (
      <button type="button" onClick={() => openItem(item.id)} className={`min-w-0 truncate text-left text-fg hover:text-accent ${className}`} title={item.name}>
        {item.name}
      </button>
    );
  return (
    <span className={`flex min-w-0 items-center gap-1 ${className}`}>
      <a href={first.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-sky-600 underline-offset-2 hover:underline dark:text-sky-400" title={`${item.name} · ${first.site || hostOf(first.url)}`}>
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
// else a linked part's Onshape thumbnail) with the category, condition and location on it, big
// red − / green + under it, then the name, the spec line and how the robots use it. The left edge
// takes the condition's colour. The picture opens the item's window; the name opens the product.
export function ItemCard({
  item,
  categories,
  condition,
  location,
  onStep,
}: {
  item: Item;
  categories: InvCategory[];
  condition?: { label: string; color: string };
  location?: string;
  onStep: (delta: number) => void;
}) {
  const { openItem } = useInventoryPopup();
  const category = getCategory(categories, item.category);
  const spec = specLine(category, item.specs);
  const need = item.usage?.need ?? 0;
  const short = item.usage?.short ?? 0;
  const usedBy = item.usage?.parts.length ?? 0;
  const color = condition ? conditionColor(condition.color) : undefined;

  return (
    <div className="card-interactive group flex flex-col border-l-4 text-sm" style={color ? { borderLeftColor: color } : undefined}>
      <button type="button" onClick={() => openItem(item.id)} className="thumb-well relative flex aspect-[4/3] items-center justify-center" aria-label={`Open ${item.name}`}>
        {item.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
          <img src={item.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain p-3" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-subtle">
            <Icon name="box" className="h-10 w-10" />
            <span className="text-[11px]">{category?.label}</span>
          </span>
        )}
      </button>
      <div className="pointer-events-none absolute top-2 left-2 flex max-w-[60%] flex-wrap gap-1">
        {category && <span className="truncate rounded-full bg-[#111318]/85 px-2 py-0.5 text-[11px] font-semibold text-white">{category.label}</span>}
        {condition && (
          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: color, color: textOn(color!) }}>
            {condition.label}
          </span>
        )}
      </div>
      {location && (
        <span className="pointer-events-none absolute top-2 right-2 rounded-full border border-line bg-surface/90 px-2 py-0.5 text-[11px] font-semibold text-fg-2 backdrop-blur-md">
          📍 {location}
        </span>
      )}

      <div className="-mt-12 flex items-center justify-between gap-2 px-2 pb-2">
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
          {formatStock(item.inStock, item.sheet)}
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
        <div className="flex min-w-0 items-baseline gap-2">
          <ProductName item={item} className="flex-1 font-semibold" />
          {spec && <span className="shrink-0 truncate font-mono text-[11px] text-muted tabular-nums">{spec}</span>}
        </div>
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
