"use client";

import Link from "next/link";
import { getInventoryCategory } from "@/config/inventory";
import { getPartType } from "@/config/partTypes";
import { textOn } from "@/components/bom/options";
import { Popover } from "@/components/bom/Popover";
import { Icon } from "@/components/ui/Icon";
import { SHEET_PIECES, formatStock } from "@/lib/inventory/stock";
import type { Item } from "./types";

// Seeded conditions carry a colour name (FRCBOM's); ones added since carry a hex colour.
const NAMED: Record<string, string> = { emerald: "#10b981", amber: "#f59e0b", rose: "#f43f5e", sky: "#0ea5e9", slate: "#64748b", violet: "#8b5cf6" };
export const conditionColor = (color: string) => NAMED[color] ?? color;

// The part type's details in one short mono line: "22T · 1/2In HEX".
export function specLine(item: Pick<Item, "templateId" | "templateValues">) {
  const type = item.templateId ? getPartType(item.templateId) : undefined;
  return (type?.fields ?? [])
    .filter((f) => item.templateValues[f.id])
    .map((f) => (f.id === "teeth" ? `${item.templateValues[f.id]}T` : item.templateValues[f.id]))
    .join(" · ");
}

// An inventory item as a compact 4:3 card, like the part cards: the picture (a linked part's
// Onshape thumbnail until the team adds photos) with the category, condition and location on
// it, big red − / green + under it, then the name, the spec line and how the robots use it.
// The left edge takes the condition's colour. The name opens the item page.
export function ItemCard({
  item,
  condition,
  location,
  onStep,
}: {
  item: Item;
  condition?: { label: string; color: string };
  location?: string;
  onStep: (delta: number) => void;
}) {
  const category = getInventoryCategory(item.category);
  const spec = specLine(item);
  const need = item.usage?.need ?? 0;
  const short = item.usage?.short ?? 0;
  const usedBy = item.usage?.parts.length ?? 0;
  const color = condition ? conditionColor(condition.color) : undefined;
  const href = `/inventory/item/${item.id}`;

  return (
    <div className="card-interactive group flex flex-col border-l-4 text-sm" style={color ? { borderLeftColor: color } : undefined}>
      <Link href={href} className="thumb-well relative flex aspect-[4/3] items-center justify-center" aria-label={`Open ${item.name}`}>
        {item.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
          <img src={item.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain p-3" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-subtle">
            <Icon name="box" className="h-10 w-10" />
            <span className="text-[11px]">{category?.label}</span>
          </span>
        )}
      </Link>
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
          className="press z-10 flex h-10 w-10 items-center justify-center rounded-md bg-rose-500 text-xl font-bold text-white shadow-sm hover:bg-rose-400 disabled:opacity-30"
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
          className="press z-10 flex h-10 w-10 items-center justify-center rounded-md bg-emerald-500 text-xl font-bold text-white shadow-sm hover:bg-emerald-400"
          aria-label={item.sheet ? "One sheet more" : "One more"}
        >
          +
        </button>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 p-3 pt-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <Link href={href} className="min-w-0 flex-1 truncate font-semibold text-fg hover:text-accent" title={item.name}>
            {item.name}
          </Link>
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
          {item.material && <span className="truncate rounded-full bg-raised px-2 py-0.5 text-fg-2">{item.material}</span>}
          {item.vendorUrl && (
            <a href={item.vendorUrl} target="_blank" rel="noreferrer" className="truncate rounded-full bg-raised px-2 py-0.5 text-sky-600 hover:underline dark:text-sky-400">
              {item.vendorName || hostOf(item.vendorUrl)} ↗
            </a>
          )}
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
