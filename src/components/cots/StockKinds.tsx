"use client";

import { useMemo, useState } from "react";
import { Collage } from "@/components/bom/GroupCards";
import type { CardPart } from "@/components/bom/types";
import { Icon } from "@/components/ui/Icon";
import { orderPicture } from "./CotsCard";
import { findGroup, groupParts, type BomGroup, type GroupItem } from "@/lib/parts/bomGroups";

// The order pages' parts with no vendor, by stock kind (Harel, 2026-11-24): the system page's
// automatic groups (lib/parts/bomGroups.ts: plates by material with every thickness inside, tubes,
// box tubes, shafts, bearings, screws...), one level only. Made for anyone in the shop: big cards
// with a big name and count, one tap opens one, and a big ‹ goes back. The table view shows the
// same kinds as header rows that fold (`kindsOf`).
// The kinds as named sections of rows, for the table view's header rows.
export function kindsOf<R extends { key: string; part: CardPart }>(rows: R[], items: GroupItem[]): { key: string; label: string; rows: R[] }[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return groupParts(rows.map((r) => ({ ...r.part, id: r.key })), items, { stock: true }).map((g) => ({
    key: g.key,
    label: kindName(g),
    rows: g.parts.map((p) => byKey.get(p.id)!).filter(Boolean),
  }));
}

export function StockKinds<R extends { key: string; part: CardPart }>({ rows, items, children }: { rows: R[]; items: GroupItem[]; children: (rows: R[]) => React.ReactNode }) {
  const groups = useMemo(
    () =>
      groupParts(
        rows.map((r) => ({ ...r.part, id: r.key, thumbUrl: orderPicture(r.part) })),
        items,
        { stock: true },
      ),
    [rows, items],
  );
  // The cards opened, outermost first; a card that's gone (its parts left the list) closes.
  const [path, setPath] = useState<string[]>([]);
  const open = path.map((k) => findGroup(groups, k)).filter((g): g is BomGroup<CardPart> => !!g);
  const at = open.at(-1);
  // One kind only: no cards to pick from.
  if (!at && groups.length === 1 && !groups[0].children) return <>{children(rows)}</>;
  const back = (
    <button
      type="button"
      onClick={() => setPath((p) => p.slice(0, open.length - 1))}
      className="press inline-flex min-h-12 items-center gap-2 rounded-xl border border-line-strong bg-raised py-2 pr-5 pl-3 text-xl font-bold text-fg hover:border-accent/50 active:scale-[0.98]"
      aria-label={`Back from ${at ? kindName(at) : ""}`}
    >
      <span className="text-3xl leading-none text-accent">‹</span>
      {at && kindName(at)}
    </button>
  );
  if (at && !at.children) {
    const keys = new Set(at.parts.map((p) => p.id));
    return (
      <div className="space-y-3">
        {back}
        {children(rows.filter((r) => keys.has(r.key)))}
      </div>
    );
  }
  const shown = at?.children ?? groups;
  return (
    <div className="space-y-3">
      {at && back}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
        {shown.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setPath([...open.map((o) => o.key), g.key])}
            className="card-interactive group flex min-h-36 flex-col gap-3 p-3 text-left active:scale-[0.98] sm:p-4"
          >
            <span className="flex items-start justify-between gap-2">
              <Collage parts={g.parts} className="h-16 w-16 sm:h-20 sm:w-20" />
              <span className="display font-mono text-4xl leading-none text-accent tabular-nums sm:text-5xl">{g.parts.length}</span>
            </span>
            <span className="mt-auto flex items-end gap-2">
              <span className="min-w-0 flex-1">
                <span className="display block text-xl leading-tight break-words text-fg sm:text-2xl">{kindName(g)}</span>
                <span className="mt-0.5 block text-xs text-subtle sm:text-sm">
                  {g.children ? `${g.children.length} sizes` : `${g.parts.length} to order`}
                </span>
              </span>
              <Icon name="arrow" className="h-6 w-6 shrink-0 text-subtle transition-transform group-hover:translate-x-1 group-hover:text-accent" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// What a kind is called here: the system page's names, in shop words (a sheet is a plate).
function kindName(g: BomGroup<CardPart>): string {
  if (g.name === "COTS") return "Other parts";
  if (g.name === "Not set up") return "Other";
  // "6 mm Aluminum" and a material's card ("Aluminum") are plates; under it, "3 mm" says enough.
  if (/plate/i.test(g.name)) return g.name;
  if (g.key.startsWith("sheets:")) return `${g.name} plates`;
  if (g.key.startsWith("sheet:") && !g.name.endsWith(" mm")) return `${g.name} plates`;
  return g.name;
}
