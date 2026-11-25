"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { sendShortagesToOrder } from "@/app/(app)/inventory/actions";
import { openPartWindow } from "@/components/bom/PartDetailsHost";
import { useInventoryPopup } from "@/components/inventory/InventoryPopup";
import type { RobotShelfItem } from "@/lib/data/inventory";
import { formatStock } from "@/lib/inventory/stock";
import { safeAction } from "@/lib/safeAction";

// The robot's inventory page: what its parts draw from the shared shelf, item by item, with what
// the shelf covers and what is short, and one button that sends the short COTS parts to the
// Order List.
export function RobotInventory({ robotId, items }: { robotId: string; items: RobotShelfItem[] }) {
  const { openItem } = useInventoryPopup();
  const [filter, setFilter] = useState<"all" | "short">("all");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);
  // Cards whose parts list is open: a tap on the card opens and closes it (Harel, 2026-11-07).
  const [openCards, setOpenCards] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpenCards((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const isShort = (i: RobotShelfItem) => !i.sheet && i.covered < i.needed;
  const short = items.filter(isShort);
  const shown = filter === "short" ? short : items;
  const needed = items.reduce((n, i) => n + (i.sheet ? 0 : i.needed), 0);
  const covered = items.reduce((n, i) => n + (i.sheet ? 0 : i.covered), 0);

  if (!items.length)
    return (
      <div className="panel p-6 text-sm text-muted">
        No parts of this robot are linked to inventory yet. On a COTS card, use the inventory pill to link the part to an
        item (or add it to the inventory).
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Units covered" value={`${covered}/${needed}`} />
        <Stat label="Items short" value={String(short.length)} warn={short.length > 0} />
        <Stat label="Items used" value={String(items.length)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "short"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`press rounded-full border px-3 py-1 text-xs font-semibold ${filter === f ? "border-accent bg-accent/10 text-accent" : "border-line-strong text-fg-2"}`}
          >
            {f === "all" ? `All items · ${items.length}` : `Short · ${short.length}`}
          </button>
        ))}
          <button
            type="button"
            className="btn-primary press ml-auto"
            disabled={pending || !short.length}
            onClick={() =>
              startTransition(async () => {
                setResult(await safeAction(() => sendShortagesToOrder(robotId)));
              })
            }
          >
            {pending ? "Sending…" : "Send shortages to Order List"}
          </button>
      </div>
      {result?.error && <p className="text-sm text-rose-700">{result.error}</p>}
      {result?.message && <p className="text-sm text-emerald-700">{result.message}</p>}

      <div className="card-grid" style={{ "--card-min": "280px" } as React.CSSProperties}>
        {shown.map((item) => {
          const tone = item.sheet ? "text-fg" : isShort(item) ? "text-amber-600" : "text-emerald-600";
          return (
            <div
              key={item.id}
              role="button"
              tabIndex={0}
              aria-expanded={openCards.has(item.id)}
              onClick={() => toggle(item.id)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  toggle(item.id);
                }
              }}
              className="panel flex cursor-pointer flex-col gap-2 p-3 hover:border-line-strong"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openItem(item.id);
                    }}
                    className="block max-w-full truncate text-left font-semibold hover:text-accent"
                    title={item.name}
                  >
                    {item.name}
                  </button>
                  {item.group && <div className="truncate text-[0.6875rem] text-muted">{item.group}</div>}
                </div>
                <div className={`shrink-0 text-right ${tone}`}>
                  <div className="font-mono text-2xl leading-none font-semibold tabular-nums">
                    {item.sheet ? formatStock(item.inStock, true) : item.covered}
                    {!item.sheet && <span className="text-sm">/{item.needed}</span>}
                  </div>
                  <div className="text-[0.625rem] font-semibold tracking-wide uppercase">{item.sheet ? "sheets" : "covered"}</div>
                </div>
              </div>
              {!item.sheet && (
                <div className="text-xs text-muted">
                  <span className="font-mono tabular-nums">{formatStock(item.inStock)}</span> on the shelf
                  {item.needAll > item.needed && (
                    <>
                      , all robots need <span className="font-mono tabular-nums">{item.needAll}</span>
                    </>
                  )}
                </div>
              )}
              <div className="flex items-center gap-1.5 border-t border-line pt-2 text-xs font-semibold text-muted">
                <span className={`transition-transform ${openCards.has(item.id) ? "rotate-90" : ""}`}>›</span>
                {item.parts.length === 1 ? "1 part" : `${item.parts.length} parts`}
              </div>
              {openCards.has(item.id) && (
                <ul className="-mx-1 divide-y divide-line">
                  {item.parts.map((p) => (
                    <li key={p.partId}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openPartWindow(p.partId);
                        }}
                        className="flex min-h-10 w-full items-center gap-2 rounded px-1 py-1.5 text-left text-sm hover:bg-raised active:scale-[0.98]"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <span className="text-muted">{p.systemName} › </span>
                          <span className="font-medium">{p.partName}</span>
                        </span>
                        {p.status && <span className="shrink-0 text-xs text-subtle">{p.status}</span>}
                        {!item.sheet && (
                          <span className={`shrink-0 font-mono text-xs tabular-nums ${p.covered < p.quantity ? "text-amber-600" : "text-emerald-600"}`}>
                            {p.covered}/{p.quantity}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <Link href="/inventory" className="inline-block text-sm text-accent hover:underline">
        Open team inventory →
      </Link>
    </div>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="panel p-4">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div className={`display font-mono text-4xl tabular-nums ${warn ? "text-amber-600" : "text-accent"}`}>{value}</div>
    </div>
  );
}
