"use client";

import Link from "next/link";
import { CATEGORY_GROUPS, type CategoryGroupId } from "@/config/inventory";
import { Icon, type IconName } from "./Icon";

export type BoxCount = { count: number; short?: number };
type Category = { id: string; label: string; group: CategoryGroupId; imageUrl?: string | null };

// The query string with some keys changed, pushed without a server round trip (useSearchParams
// sees it), so filter boxes switch at once and Back steps out again.
export function pushQuery(changes: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(changes)) {
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  window.history.pushState(null, "", url.pathname + url.search);
}

// A soft blurred patch in one corner of a picture box, under its count, name or short tag,
// fading into the picture. Only the patch is masked, so the text on it stays crisp.
function Frost({ at, className, children }: { at: "top left" | "top right" | "bottom left"; className: string; children: React.ReactNode }) {
  const fade = `radial-gradient(ellipse at ${at}, black 45%, transparent 72%)`;
  const tint = at.startsWith("bottom") ? "var(--color-well-2)" : "var(--color-well)"; // the stage's gradient at that edge
  return (
    <span className={`absolute ${className}`}>
      <span
        className="absolute inset-0 backdrop-blur-[4px]"
        style={{ maskImage: fade, background: `radial-gradient(ellipse at ${at}, color-mix(in srgb, ${tint} 85%, transparent) 30%, transparent 72%)` }}
      />
      <span className="relative block">{children}</span>
    </span>
  );
}

// The group boxes over the category boxes (Inventory and COTS share them). The top level shows one
// box per group; a group swaps the row for its categories, with a route line back up
// ("All categories / Electrical / Motors"). A category either opens its page (`categoryHref`) or
// filters in place (`onCategory`). A count turns red when something in the box is short. With
// route={false} the page shows that line itself, once, at the top (Inventory).
export function CategoryBoxes({
  categories,
  counts,
  group,
  category = null,
  onGroup,
  onCategory,
  categoryHref,
  root = "All categories",
  compact = false,
  route = true,
}: {
  categories: Category[];
  counts: Map<string, BoxCount>; // by group id and by category id
  group: CategoryGroupId | null;
  category?: string | null;
  onGroup: (id: CategoryGroupId | null) => void;
  onCategory?: (id: string | null) => void;
  categoryHref?: (id: string) => string;
  root?: string;
  compact?: boolean;
  route?: boolean;
}) {
  const g = CATEGORY_GROUPS.find((x) => x.id === group);
  const cat = categories.find((c) => c.id === category);
  const boxes = g
    ? categories.filter((c) => c.group === g.id).map((c) => ({ id: c.id, label: c.label, imageUrl: c.imageUrl ?? null, icon: null as IconName | null, text: null as string | null }))
    : CATEGORY_GROUPS.map((x) => ({ id: x.id, label: x.label, imageUrl: null, icon: x.icon as IconName, text: x.text as string | null }));

  const crumb = "press rounded px-1 font-semibold hover:text-accent active:scale-[0.98]";
  return (
    <div className="space-y-2">
      {g && route && (
        <nav aria-label="Category route" className="flex flex-wrap items-center gap-1 text-xs text-subtle">
          <button type="button" onClick={() => onGroup(null)} className={crumb}>
            {root}
          </button>
          <span>/</span>
          {cat ? (
            <>
              <button type="button" onClick={() => onCategory?.(null)} className={crumb}>
                {g.label}
              </button>
              <span>/</span>
              <span className="px-1 font-semibold text-fg">{cat.label}</span>
            </>
          ) : (
            <span className="px-1 font-semibold text-fg">{g.label}</span>
          )}
        </nav>
      )}
      <div
        className={compact ? "-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible" : g ? "card-grid" : "grid gap-3 sm:grid-cols-2 lg:grid-cols-5"}
        style={compact || !g ? undefined : ({ "--card-min": "165px" } as React.CSSProperties)}
      >
        {boxes.map((b) => {
          const n = counts.get(b.id) ?? { count: 0 };
          const selected = !!g && b.id === category;
          const select = () => (g ? onCategory?.(selected ? null : b.id) : onGroup(b.id as CategoryGroupId));
          const number = (
            <span className={`font-mono tabular-nums ${n.short ? "text-rose-500" : compact ? "text-subtle" : "text-accent"}`} title={n.short ? `${n.short} short` : undefined}>
              {n.count}
            </span>
          );
          const shortPill = !!n.short && (
            <span className="rounded-full bg-rose-500 px-1.5 py-0.5 font-mono text-[10px] font-bold whitespace-nowrap text-white tabular-nums">{n.short} short</span>
          );
          const body = compact ? (
            <>
              <span className={`relative h-full w-12 shrink-0 overflow-hidden ${b.imageUrl ? "thumb-well" : ""}`}>
                {b.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- static or short-lived R2 links, not optimisable
                  <img src={b.imageUrl} alt="" className="h-full w-full object-contain p-1 transition-transform duration-150 group-hover:scale-[1.03]" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-sky-500/25 via-raised to-amber-400/20 text-sky-400">
                    {b.icon && <Icon name={b.icon} className="h-5 w-5" />}
                  </span>
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-xs leading-tight font-bold whitespace-nowrap text-fg">{b.label}</span>
                <span className="flex items-center gap-1 text-[11px]">
                  {number}
                  {shortPill}
                </span>
              </span>
            </>
          ) : b.imageUrl ? (
            // A picture box is one whole picture; the count and name float over it on soft blurred
            // fades. The stage is light in both themes, so their text stays dark.
            <span className="thumb-well relative block aspect-[16/9] w-full">
              {/* eslint-disable-next-line @next/next/no-img-element -- static or short-lived R2 links, not optimisable */}
              <img src={b.imageUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-contain pt-2 pr-1.5 pb-1.5 pl-[22%]" />
              <span className="pointer-events-none absolute inset-0">
                <Frost at="top left" className="top-0 left-0 pt-2.5 pr-10 pb-5 pl-3.5">
                  <span className="display text-4xl leading-none">{number}</span>
                </Frost>
                {shortPill && (
                  <Frost at="top right" className="top-0 right-0 pt-2 pr-2.5 pb-4 pl-7">
                    {shortPill}
                  </Frost>
                )}
                <Frost at="bottom left" className="bottom-0 left-0 max-w-full pt-5 pr-12 pb-2.5 pl-3.5">
                  <span className="block truncate text-base font-semibold text-[#111318] group-hover:text-accent">{b.label}</span>
                </Frost>
              </span>
            </span>
          ) : (
            <>
              <span className="flex items-start justify-between gap-2">
                <span className="display text-4xl">{number}</span>
                {shortPill}
              </span>
              {b.icon && <Icon name={b.icon} className="pointer-events-none absolute right-4 bottom-4 h-10 w-10 text-sky-400/40" />}
              <span className="min-w-0 pr-14">
                <span className="block text-base font-semibold text-fg group-hover:text-accent">{b.label}</span>
                {b.text && <span className="block text-xs text-muted">{b.text}</span>}
              </span>
            </>
          );
          const cls = compact
            ? "card-interactive group flex h-12 shrink-0 items-center gap-2.5 overflow-hidden pr-3 text-left active:scale-[0.98]"
            : b.imageUrl
              ? "card-interactive group relative flex flex-col text-left active:scale-[0.98]"
              : "card-interactive group relative flex min-h-32 flex-col justify-between p-4 text-left active:scale-[0.98]";
          return g && categoryHref ? (
            <Link key={b.id} href={categoryHref(b.id)} className={cls}>
              {body}
            </Link>
          ) : (
            <button key={b.id} type="button" onClick={select} data-selected={selected} aria-pressed={selected} className={cls}>
              {body}
            </button>
          );
        })}
      </div>
    </div>
  );
}
