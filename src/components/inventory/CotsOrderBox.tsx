"use client";

import Link from "next/link";
import { useState } from "react";
import { COTS_ORDERED, COTS_RELEASED, ORDER_STATUSES, getCotsStatus } from "@/config/cots";
import { textOn } from "@/components/bom/options";
import { statusDenied } from "@/components/shell/mode";
import { useCan, useMode } from "@/components/shell/ModeContext";
import { formatPrice, useCurrency } from "@/components/cots/currency";
import { siteOf } from "@/lib/cots";
import type { PartChanges } from "@/lib/parts/changes";

// The COTS card behind an item, shown in the item window when it is opened from a COTS card (or
// the item has an order on its way): a big Need to Order count with − / +, the order status, and
// where to buy it (Harel, 2026-11-01).
export type CotsOrderInfo = {
  quantity: number;
  status: string;
  links: { url: string; site?: string; priceUsd?: number }[];
  unitPrice: number | null;
  sentBack: string | null;
  // The same part from several systems: the count is their sum, so it is changed on each card.
  grouped?: boolean;
  // The COTS page that shows the card, when the window was opened from somewhere else.
  href?: string;
};

const STATUSES = [COTS_RELEASED, ...ORDER_STATUSES];

export function CotsOrderBox({ info, onSave, onLeave }: { info: CotsOrderInfo; onSave: (changes: PartChanges) => void; onLeave?: () => void }) {
  const work = useCan("work");
  const { mode } = useMode();
  const currency = useCurrency();
  // Shown at once; the save runs behind (the window may hold an old copy of the card).
  const [status, setStatus] = useState(info.status);
  const [qty, setQty] = useState(info.quantity);
  const [typed, setTyped] = useState<string | null>(null);
  const canCount = work && !info.grouped;

  const setCount = (n: number) => {
    const next = Math.max(1, Math.min(100000, Math.round(n)));
    setTyped(null);
    if (next === qty) return;
    setQty(next);
    onSave({ quantity: next });
  };
  const pick = (s: string) => {
    if (s === status) return;
    setStatus(s);
    onSave(s === COTS_ORDERED || s === COTS_RELEASED ? { status: s, cotsSentBack: null } : { status: s });
  };
  const vendor = info.links[0];
  const total = info.unitPrice == null ? null : info.unitPrice * Math.max(qty, 1);
  const stepBtn = "press flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl font-bold text-white shadow-sm active:scale-[0.98] disabled:opacity-30";

  return (
    <section className="space-y-3 rounded-xl border border-line bg-raised/60 p-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]" aria-label="COTS order">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-subtle uppercase">Need to order</span>
        {info.href && (
          <Link href={info.href} onClick={onLeave} className="text-xs font-semibold text-accent hover:underline">
            Open in COTS →
          </Link>
        )}
      </div>
      <div className="flex items-center gap-2">
        {canCount && (
          <button type="button" onClick={() => setCount(qty - 1)} disabled={qty <= 1} className={`${stepBtn} bg-rose-500 hover:bg-rose-400`} aria-label="Order one less">
            −
          </button>
        )}
        {canCount ? (
          <input
            value={typed ?? String(qty)}
            onChange={(e) => setTyped(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={() => typed !== null && (typed === "" ? setTyped(null) : setCount(Number(typed)))}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setTyped(null);
            }}
            inputMode="numeric"
            aria-label="Need to order"
            className="min-w-0 flex-1 rounded-lg border border-line bg-transparent py-1 text-center font-mono text-3xl font-bold text-fg tabular-nums focus:border-sky-400/60 focus:outline-none"
          />
        ) : (
          <span className="flex-1 text-center font-mono text-3xl font-bold text-fg tabular-nums" title={info.grouped ? "The sum of several systems' cards" : undefined}>
            {qty}
          </span>
        )}
        {canCount && (
          <button type="button" onClick={() => setCount(qty + 1)} className={`${stepBtn} bg-emerald-500 hover:bg-emerald-400`} aria-label="Order one more">
            +
          </button>
        )}
      </div>

      <div className="space-y-1.5">
        <span className="text-[11px] font-semibold tracking-wide text-subtle uppercase">Order status</span>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {STATUSES.map((s) => {
            const c = getCotsStatus(s)!.color;
            const on = s === status;
            const denied = !work || (!on && !!statusDenied(mode, s, { cots: true }));
            return (
              <button
                key={s}
                type="button"
                onClick={() => pick(s)}
                disabled={denied}
                aria-pressed={on}
                className={`press flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-bold active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${
                  on ? "border-black/20 shadow-sm" : "border-line text-fg-2 hover:border-sky-400/40"
                }`}
                style={on ? { background: c, color: textOn(c) } : undefined}
              >
                {!on && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />}
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {info.sentBack && status === COTS_RELEASED && (
        <p className="rounded-md bg-rose-600/15 px-2 py-1 text-xs font-semibold text-rose-400">↩ Sent back: {info.sentBack}</p>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Vendor</dt>
        <dd className="flex min-w-0 flex-wrap gap-x-2">
          {vendor ? (
            info.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="truncate font-semibold text-accent hover:underline">
                {siteOf(l)} ↗
              </a>
            ))
          ) : (
            <span className="text-faint">No product link yet</span>
          )}
        </dd>
        <dt className="text-muted">Order</dt>
        <dd className="font-mono text-fg-2 tabular-nums">
          {info.unitPrice == null ? (
            <span className="font-sans text-faint">No price yet</span>
          ) : (
            <>
              {qty} × {formatPrice(info.unitPrice, currency)} = <span className="font-bold text-emerald-500">{formatPrice(total!, currency)}</span>
            </>
          )}
        </dd>
      </dl>
    </section>
  );
}
