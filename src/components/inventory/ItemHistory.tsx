"use client";

import { useState } from "react";
import { timeAgo } from "@/components/actions/RecentActions";
import type { ItemHistoryEntry } from "@/lib/data/inventory";
import { getCategory } from "@/lib/inventory/categories";
import { formatStock } from "@/lib/inventory/stock";
import type { Condition, InvCategory, Location } from "./types";

const MOVE_LABEL: Record<string, string> = { received: "Received", used: "Used", broke: "Broke", counted: "Counted", returned: "Returned" };

// One timeline of an item: its stock moves (a typed count reads "Set to 12 (was 9)") and its
// edits (created, renamed, moved, new photo…), newest first.
export function ItemHistory({
  history,
  sheet,
  categories,
  locations,
  conditions,
}: {
  history: ItemHistoryEntry[];
  sheet: boolean;
  categories: InvCategory[];
  locations: Location[];
  conditions: Condition[];
}) {
  const [now] = useState(() => Date.now());
  if (!history.length) return <p className="text-sm text-muted">No changes yet.</p>;
  const stock = (n: number) => formatStock(Math.abs(n), sheet);
  const nameOf = (field: string, v: unknown) => {
    if (v == null || v === "") return "none";
    if (field === "category") return getCategory(categories, String(v))?.label ?? String(v);
    if (field === "locationId") return locations.find((l) => l.id === v)?.name ?? "a removed location";
    if (field === "conditionId") return conditions.find((c) => c.id === v)?.label ?? "a removed condition";
    if (field === "price") return `$${Number(v).toFixed(2)}`;
    return String(v);
  };
  const editText = (e: Extract<ItemHistoryEntry, { kind: "edit" }>) => {
    switch (e.field) {
      case "created":
        return "Added to the inventory";
      case "name":
        return `Renamed from “${nameOf("name", e.from)}”`;
      case "specs":
        return "Details changed";
      case "cotsLinks":
        return "Product links changed";
      case "imagePath":
        return "New photo";
      default: {
        const label = { category: "Category", locationId: "Location", conditionId: "Condition", price: "Price", seasonNeed: "Needed for season" }[e.field] ?? e.field;
        return `${label}: ${nameOf(e.field, e.from)} → ${nameOf(e.field, e.to)}`;
      }
    }
  };
  return (
    <ul className="divide-y divide-line text-sm">
      {history.map((h) => (
        <li key={h.id} className="flex items-center gap-3 py-1.5">
          {h.kind === "move" ? (
            <>
              <span className={`w-14 shrink-0 text-right font-mono font-semibold tabular-nums ${h.delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {h.delta > 0 ? "+" : "−"}
                {stock(h.delta)}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {h.reason === "counted" ? (
                  <>
                    Set to <span className="font-mono font-semibold tabular-nums">{stock(h.after)}</span>
                    <span className="text-muted"> (was {stock(h.after - h.delta)})</span>
                  </>
                ) : (
                  (MOVE_LABEL[h.reason] ?? h.reason)
                )}
                {h.partName && <span className="text-muted"> · {h.partName}</span>}
              </span>
            </>
          ) : (
            <>
              <span className="w-14 shrink-0 text-right text-xs text-subtle">{h.field === "created" ? "new" : "edit"}</span>
              <span className="min-w-0 flex-1 truncate">{editText(h)}</span>
            </>
          )}
          <span className="shrink-0 text-xs text-subtle" title={new Date(h.at).toLocaleString()}>
            {h.who ?? "Someone"} · {timeAgo(h.at, now)}
          </span>
        </li>
      ))}
    </ul>
  );
}
