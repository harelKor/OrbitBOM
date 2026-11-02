"use client";

import { useState } from "react";
import { timeAgo } from "@/components/actions/RecentActions";
import type { ItemHistoryEntry, OrderHistoryCard } from "@/lib/data/inventory";
import { getCategory } from "@/lib/inventory/categories";
import { formatStock } from "@/lib/inventory/stock";
import type { Condition, InvCategory, Location } from "./types";

// DD/MM in Israel time.
const dayMonth = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Jerusalem",
  });

// Past orders: one line per COTS order (Sent DD/MM · Arrived DD/MM), falling back to the typed text or "-".
function PastOrders({ orders }: { orders: OrderHistoryCard[] }) {
  return (
    <div className="mb-2">
      <p className="mb-0.5 text-xs font-semibold text-subtle">Past orders</p>
      <ul className="divide-y divide-line text-sm">
        {orders.map((o) => (
          <li key={o.id} className="flex items-center gap-3 py-1.5">
            <span className="w-14 shrink-0 text-right font-mono font-semibold tabular-nums">
              ×{o.quantity}
            </span>
            <span className="min-w-0 flex-1 truncate">
              Sent{" "}
              <span className="font-mono font-semibold tabular-nums">
                {o.inRouteAt ? dayMonth(o.inRouteAt) : o.inRouteText || "-"}
              </span>
              <span className="text-muted"> · </span>
              Arrived{" "}
              <span className="font-mono font-semibold tabular-nums">
                {o.arrivedAt ? dayMonth(o.arrivedAt) : o.arrivedText || "-"}
              </span>
            </span>
            {o.vendor && (
              <span className="shrink-0 truncate text-xs text-subtle">
                {o.vendor}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const MOVE_LABEL: Record<string, string> = {
  received: "Received",
  used: "Used",
  broke: "Broke",
  counted: "Counted",
  returned: "Returned",
};

// One timeline of an item: its stock moves (a typed count reads "Set to 12 (was 9)") and its
// edits (created, renamed, moved, new photo…), newest first.
export function ItemHistory({
  history,
  orders = [],
  sheet,
  categories,
  locations,
  conditions,
}: {
  history: ItemHistoryEntry[];
  orders?: OrderHistoryCard[];
  sheet: boolean;
  categories: InvCategory[];
  locations: Location[];
  conditions: Condition[];
}) {
  const [now] = useState(() => Date.now());
  const past = orders.length > 0 && <PastOrders orders={orders} />;
  if (!history.length)
    return (
      <>
        {past}
        <p className="text-sm text-muted">No changes yet.</p>
      </>
    );
  const stock = (n: number) => formatStock(Math.abs(n), sheet);
  const nameOf = (field: string, v: unknown) => {
    if (v == null || v === "") return "none";
    if (field === "category")
      return getCategory(categories, String(v))?.label ?? String(v);
    if (field === "locationId")
      return locations.find((l) => l.id === v)?.name ?? "a removed location";
    if (field === "conditionId")
      return conditions.find((c) => c.id === v)?.label ?? "a removed condition";
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
        const label =
          {
            category: "Category",
            locationId: "Location",
            conditionId: "Condition",
            price: "Price",
            seasonNeed: "Needed for season",
            note: "Note",
            seasonTag: "Season",
          }[e.field] ?? e.field;
        return `${label}: ${nameOf(e.field, e.from)} → ${nameOf(e.field, e.to)}`;
      }
    }
  };
  return (
    <>
      {past}
      <ul className="divide-y divide-line text-sm">
        {history.map((h) => (
          <li key={h.id} className="flex items-center gap-3 py-1.5">
            {h.kind === "move" ? (
              <>
                <span
                  className={`w-14 shrink-0 text-right font-mono font-semibold tabular-nums ${h.delta > 0 ? "text-emerald-600" : "text-rose-600"}`}
                >
                  {h.delta > 0 ? "+" : "−"}
                  {stock(h.delta)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {h.reason === "counted" ? (
                    <>
                      Set to{" "}
                      <span className="font-mono font-semibold tabular-nums">
                        {stock(h.after)}
                      </span>
                      <span className="text-muted">
                        {" "}
                        (was {stock(h.after - h.delta)})
                      </span>
                    </>
                  ) : (
                    (MOVE_LABEL[h.reason] ?? h.reason)
                  )}
                  {h.partName && (
                    <span className="text-muted"> · {h.partName}</span>
                  )}
                </span>
              </>
            ) : (
              <>
                <span className="w-14 shrink-0 text-right text-xs text-subtle">
                  {h.field === "created" ? "new" : "edit"}
                </span>
                <span className="min-w-0 flex-1 truncate">{editText(h)}</span>
              </>
            )}
            <span
              className="shrink-0 text-xs text-subtle"
              title={new Date(h.at).toLocaleString()}
            >
              {h.who ?? "Someone"} · {timeAgo(h.at, now)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
