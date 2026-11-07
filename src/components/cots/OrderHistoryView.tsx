"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { dismissOrderHistory, setOrderHistoryDateText } from "@/app/(app)/cots/actions";
import { useInventoryPopup } from "@/components/inventory/InventoryPopup";
import { useCan } from "@/components/shell/ModeContext";
import { Chevron } from "@/components/ui/Chevron";
import { Icon } from "@/components/ui/Icon";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { useStoredChoice } from "@/components/ui/useStoredChoice";
import { toast } from "@/components/ui/Toaster";
import type { OrderHistoryCard } from "@/lib/data/inventory";
import { formatPrice, setCurrency, useCurrency } from "./currency";

type Side = "inRoute" | "arrived";
type Change = { id: string; dismiss?: true; side?: Side; text?: string | null };

const orderDate = (c: OrderHistoryCard) => new Date(c.inRouteAt ?? c.arrivedAt ?? c.createdAt).getTime();
const ddmm = (d: Date | string) => {
  const date = new Date(d);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
};

// The Order History page: the total price of every card on top (with the $ / ₪ switch), then the
// cards in a collapsible section per vendor, newest order first.
export function OrderHistoryView({ cards: initial }: { cards: OrderHistoryCard[] }) {
  const currency = useCurrency();
  const [view, setView] = useStoredChoice("orbit-cots-history-view", ["cards", "list"] as const, "cards");
  const [, start] = useTransition();
  const [cards, apply] = useOptimistic(initial, (list, c: Change) =>
    c.dismiss
      ? list.filter((x) => x.id !== c.id)
      : list.map((x) => (x.id !== c.id ? x : c.side === "inRoute" ? { ...x, inRouteText: c.text ?? null } : { ...x, arrivedText: c.text ?? null })),
  );
  const run = (c: Change, action: () => Promise<{ error?: string }>) =>
    start(async () => {
      apply(c);
      const res = await action();
      if (res.error) toast(res.error, true);
    });
  const dismiss = (id: string) => run({ id, dismiss: true }, () => dismissOrderHistory(id));
  const setText = (id: string, side: Side, text: string) => run({ id, side, text: text.trim() || null }, () => setOrderHistoryDateText(id, side, text));

  const total = cards.reduce((n, c) => n + (c.unitPrice == null ? 0 : c.quantity * c.unitPrice), 0);
  const vendors = new Map<string, OrderHistoryCard[]>();
  for (const c of [...cards].sort((a, b) => orderDate(b) - orderDate(a))) {
    const v = c.vendor?.trim() || "No vendor";
    vendors.set(v, [...(vendors.get(v) ?? []), c]);
  }
  // Vendors with the newest order first; "No vendor" last.
  const sections = [...vendors].sort(([a, x], [b, y]) => (a === "No vendor" ? 1 : b === "No vendor" ? -1 : orderDate(y[0]) - orderDate(x[0])));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/cots" className="text-xs font-semibold tracking-wide text-subtle uppercase hover:text-fg">
            Orders
          </Link>
          <h1 className="display text-3xl text-accent">Order History</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">Every order that went In Route or arrived, by vendor. ✕ removes a card from this page.</p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "cards", label: "Cards" },
              { value: "list", label: "List" },
            ]}
          />
          <span className="ml-2 text-xs font-semibold tracking-wide text-subtle uppercase">Total</span>
          <span className="font-mono text-2xl font-bold text-emerald-500 tabular-nums sm:text-3xl">{formatPrice(total, currency)}</span>
          <button
            type="button"
            onClick={() => setCurrency(currency === "usd" ? "ils" : "usd")}
            className="press rounded-full border border-line-strong px-2 py-0.5 text-xs font-semibold text-muted hover:border-emerald-500/60 hover:text-emerald-500 active:scale-[0.98]"
            aria-label={currency === "usd" ? "Show in shekels" : "Show in dollars"}
            title={currency === "usd" ? "Show in shekels" : "Show in dollars"}
          >
            {currency === "usd" ? "₪" : "$"}
          </button>
        </div>
      </div>
      {sections.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">
          No orders yet. A COTS part moved to In Route or Arrived shows here.
        </p>
      ) : (
        sections.map(([vendor, list]) => (
          <VendorSection key={vendor} title={vendor} count={list.length}>
            {view === "list" ? (
              <div className="list-stack">
                {list.map((c) => (
                  <HistoryRow key={c.id} card={c} onDismiss={() => dismiss(c.id)} onText={(side, text) => setText(c.id, side, text)} />
                ))}
              </div>
            ) : (
              <div className="card-grid" style={{ "--card-min": "220px" } as React.CSSProperties}>
                {list.map((c) => (
                  <HistoryCard key={c.id} card={c} onDismiss={() => dismiss(c.id)} onText={(side, text) => setText(c.id, side, text)} />
                ))}
              </div>
            )}
          </VendorSection>
        ))
      )}
    </div>
  );
}

function VendorSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="space-y-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="press flex w-full items-center gap-3 py-1 text-left">
        <Chevron open={open} />
        <h2 className="display text-2xl font-bold">{title}</h2>
        <span className="rounded-full bg-raised px-2.5 py-0.5 font-mono text-sm font-bold text-fg-2 tabular-nums">{count}</span>
        <div className="h-0.5 flex-1 bg-line-strong" />
      </button>
      {open && children}
    </section>
  );
}

// One order: the item's picture with the bold amount top-left and ✕ top-right, the name (links to
// the product page), and "DD/MM → DD/MM" from In Route to arrival. A missing date shows "-" (or
// text typed in its place): click it to type. Clicking the card opens the item's window.
function HistoryCard({ card, onDismiss, onText }: { card: OrderHistoryCard; onDismiss: () => void; onText: (side: Side, text: string) => void }) {
  const { openItem } = useInventoryPopup();
  const work = useCan("work");
  const open = () => card.inventoryItemId && openItem(card.inventoryItemId);
  return (
    <div onClick={open} className={`card-interactive group flex flex-col text-sm ${card.inventoryItemId ? "cursor-pointer" : ""}`}>
      <div className="thumb-well thumb-cots relative flex aspect-[4/3] items-center justify-center">
        {card.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived R2 links, not optimisable
          <img src={card.thumbUrl} alt="" loading="lazy" className="h-full w-full object-contain p-3" />
        ) : (
          <span className="text-xs text-muted">No picture</span>
        )}
        <span className="absolute top-2 left-2 rounded-full bg-[#111318]/85 px-3 py-1 font-mono text-base font-bold text-white tabular-nums">×{card.quantity}</span>
        {work && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            title="Remove from Order History"
            aria-label={`Remove ${card.name} from Order History`}
            className="press absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-surface/90 text-subtle shadow-md backdrop-blur-md hover:text-fg active:scale-[0.98]"
          >
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1 px-2.5 py-2">
        <div className="truncate font-semibold" title={card.name}>
          {card.productUrl ? (
            <a
              href={card.productUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-sky-500 underline-offset-2 hover:underline dark:text-sky-400"
            >
              {card.name}
            </a>
          ) : (
            <span className="text-fg">{card.name}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 font-mono text-xs font-bold whitespace-nowrap text-fg-2 tabular-nums">
          <DateSlot date={card.inRouteAt} text={card.inRouteText} editable={work} onSave={(t) => onText("inRoute", t)} />
          <span className="text-subtle">→</span>
          <DateSlot date={card.arrivedAt} text={card.arrivedText} editable={work} onSave={(t) => onText("arrived", t)} />
        </div>
      </div>
    </div>
  );
}

// The same order as one List view row: picture, name (links to the product page), then the bold
// amount, "DD/MM → DD/MM" and the price; ✕ before the chevron. A tap opens the item's window.
function HistoryRow({ card, onDismiss, onText }: { card: OrderHistoryCard; onDismiss: () => void; onText: (side: Side, text: string) => void }) {
  const { openItem } = useInventoryPopup();
  const work = useCan("work");
  const currency = useCurrency();
  return (
    <ListRow
      picture={card.thumbUrl}
      title={card.name}
      href={card.productUrl}
      onOpen={() => card.inventoryItemId && openItem(card.inventoryItemId)}
      pills={
        <span className="flex items-center gap-2.5 font-mono text-sm font-bold whitespace-nowrap text-fg-2 tabular-nums">
          <span className="text-fg">×{card.quantity}</span>
          <span className="flex items-center gap-1.5">
            <DateSlot date={card.inRouteAt} text={card.inRouteText} editable={work} onSave={(t) => onText("inRoute", t)} />
            <span className="text-subtle">→</span>
            <DateSlot date={card.arrivedAt} text={card.arrivedText} editable={work} onSave={(t) => onText("arrived", t)} />
          </span>
          {card.unitPrice != null && <span className="text-emerald-500">{formatPrice(card.quantity * card.unitPrice, currency)}</span>}
        </span>
      }
      actions={
        work && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            title="Remove from Order History"
            aria-label={`Remove ${card.name} from Order History`}
            className="press flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-raised text-subtle hover:text-fg active:scale-[0.98]"
          >
            <Icon name="close" className="h-3.5 w-3.5" />
          </button>
        )
      }
    />
  );
}

function DateSlot({ date, text, editable, onSave }: { date: Date | string | null; text: string | null; editable: boolean; onSave: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (date) return <span>{ddmm(date)}</span>;
  if (!editable) return <span>{text || "-"}</span>;
  if (editing)
    return (
      <input
        autoFocus
        defaultValue={text ?? ""}
        maxLength={40}
        onClick={(e) => e.stopPropagation()}
        onBlur={(e) => {
          setEditing(false);
          if (e.currentTarget.value.trim() !== (text ?? "")) onSave(e.currentTarget.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            e.currentTarget.value = text ?? "";
            e.currentTarget.blur();
          }
        }}
        className="w-20 rounded border border-line-strong bg-surface px-1 py-0.5 font-mono text-xs font-bold text-fg outline-none focus:border-accent"
      />
    );
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      title="Click to type"
      className="press max-w-28 truncate rounded px-1 hover:bg-raised hover:text-fg"
    >
      {text || "-"}
    </button>
  );
}
