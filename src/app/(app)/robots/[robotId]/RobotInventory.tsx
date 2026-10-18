"use client";

import Link from "next/link";
import { useState } from "react";
import type { UsagePart } from "@/lib/inventory/usage";

type Item = { id: string; name: string; group: string; inStock: number; needed: number; parts: UsagePart[] };

// "Inventory on this robot" (ref §2, screenshot 09): what this robot's parts draw from the team
// inventory, shown as "in stock / needed", with a filter chip per group.
export function RobotInventory({ items }: { items: Item[] }) {
  const [group, setGroup] = useState<string | null>(null);
  const groups = [...new Set(items.map((i) => i.group).filter(Boolean))].sort();
  const shown = group === null ? items : items.filter((i) => i.group === group);

  return (
    <section className="panel p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Inventory on this robot</h2>
        <Link href="/inventory" className="text-sm text-indigo-300 hover:text-indigo-200">
          Open team inventory →
        </Link>
      </div>
      <p className="mb-3 text-sm text-slate-400">
        Everything this robot&apos;s parts draw from the team inventory.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">
          No parts are tied to inventory yet. Pick an item in a part&apos;s Material menu, or use To BOM on the
          Inventory page.
        </p>
      ) : (
        <>
          {groups.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {[null, ...groups].map((g) => (
                <button
                  key={g ?? "all"}
                  onClick={() => setGroup(g)}
                  className={`rounded-md border px-2 py-0.5 text-xs ${
                    group === g ? "border-indigo-400 bg-indigo-500/20 text-indigo-200" : "border-slate-700 text-slate-300"
                  }`}
                >
                  {g ?? "All groups"}
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((item) => {
              const short = item.inStock < item.needed;
              return (
                <div key={item.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium" title={item.name}>
                        {item.name}
                      </div>
                      {item.group && (
                        <span className="mt-1 inline-block rounded border border-slate-700 px-1.5 text-[11px] text-slate-400">
                          {item.group}
                        </span>
                      )}
                    </div>
                    <div className={`text-right ${short ? "text-amber-300" : "text-emerald-300"}`}>
                      <div className="text-2xl leading-none font-semibold">
                        {item.inStock}
                        <span className="text-sm">/{item.needed}</span>
                      </div>
                      <div className="text-[10px] font-semibold tracking-wide uppercase">in stock</div>
                    </div>
                  </div>
                  <ul className="mt-2 space-y-0.5 text-xs text-slate-400">
                    {item.parts.map((p) => (
                      <li key={p.partId} className="truncate">
                        {p.systemName} › <span className="text-slate-200">{p.partName}</span> ×{p.quantity}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
