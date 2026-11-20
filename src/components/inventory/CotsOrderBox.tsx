"use client";

import Link from "next/link";
import { useState } from "react";
import { BEFORE_IN_ROUTE, COTS_IN_ROUTE, COTS_ORDERED, COTS_RELEASED, ORDER_STATUSES, getCotsStatus } from "@/config/cots";
import { Popover } from "@/components/bom/Popover";
import { textOn } from "@/components/bom/options";
import { statusDenied } from "@/components/shell/mode";
import { useCan, useMode } from "@/components/shell/ModeContext";
import { useOverdue } from "@/components/cots/overdue";
import type { PartChanges } from "@/lib/parts/changes";

// The COTS card behind an item, shown in the item window as two small glowing boxes under Needed
// for Season: the order status and how many are being ordered, and on the Order List a slim row
// under them with the delivery date. They change only when the window
// was opened from the COTS page; anywhere else they are read-only (Harel, 2026-11-02).
export type CotsOrderInfo = {
  quantity: number;
  status: string;
  links: { url: string; site?: string; priceUsd?: number }[];
  unitPrice: number | null;
  sentBack: string | null;
  deliveryDate?: string | null; // when the order is due (Harel, 2026-11-05)
  // The same part from several systems: the count is their sum, so it is changed on each card.
  grouped?: boolean;
  // The COTS page that shows the card, when the window was opened from somewhere else.
  href?: string;
};

const STATUSES = [COTS_RELEASED, ...ORDER_STATUSES];
// Only an item on its way (Released or the Order List) gets the boxes.
export const showsOrder = (status: string) => STATUSES.includes(status as (typeof STATUSES)[number]);

const HALO = "rounded-xl border border-amber-400/55 bg-raised ring-1 ring-amber-400/35 shadow-[0_0_18px_-4px_rgba(251,191,36,0.3)]";
const LABEL = "text-[0.625rem] leading-none font-semibold tracking-wide text-subtle uppercase";

export function CotsOrderBox({ info, onSave, editable, onLeave }: { info: CotsOrderInfo; onSave: (changes: PartChanges) => void; editable: boolean; onLeave?: () => void }) {
  const work = useCan("work");
  const { mode } = useMode();
  // Shown at once; the save runs behind (the window may hold an old copy of the card).
  const [status, setStatus] = useState(info.status);
  const [qty, setQty] = useState(info.quantity);
  const [typed, setTyped] = useState<string | null>(null);
  const [delivery, setDelivery] = useState(info.deliveryDate ?? null);
  const late = useOverdue(delivery, status);
  const canStatus = editable && work;
  const canCount = editable && work && !info.grouped;

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
  const color = getCotsStatus(status)?.color ?? "#cbd5e1";
  const pill = (
    <span className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-fg">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="truncate">{status}</span>
      {canStatus && <span className="text-xs text-subtle">▾</span>}
    </span>
  );
  const sentBack = info.sentBack && status === COTS_RELEASED ? `Sent back: ${info.sentBack}` : undefined;

  return (
    <div className="grid w-full max-w-sm grid-cols-2 gap-2" aria-label="COTS order">
      <div className={`${HALO} flex min-w-0 flex-col justify-center gap-1 px-3 py-1.5`} title={sentBack}>
        <span className={LABEL}>{sentBack ? "↩ Order status" : "Order status"}</span>
        {canStatus ? (
          <Popover hideCaret triggerClassName="press -mx-1 rounded-md px-1 text-left hover:bg-surface active:scale-[0.98]" trigger={pill}>
            {(close) => (
              <div className="space-y-1 p-1">
                {STATUSES.map((s) => {
                  const c = getCotsStatus(s)!.color;
                  const on = s === status;
                  const denied = !on && !!statusDenied(mode, s, { cots: true });
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={denied}
                      onClick={() => {
                        pick(s);
                        close();
                      }}
                      className={`press flex min-h-9 w-full items-center justify-center rounded-lg border border-black/20 text-sm font-bold active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ${on ? "ring-2 ring-fg/50 ring-offset-1" : ""}`}
                      style={{ background: c, color: textOn(c) }}
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            )}
          </Popover>
        ) : info.href ? (
          <Link href={info.href} onClick={onLeave} className="press -mx-1 rounded-md px-1 hover:bg-surface active:scale-[0.98]" title="Open it on the COTS page">
            {pill}
          </Link>
        ) : (
          pill
        )}
      </div>
      {/* One line: the label on the left, the amount big on the right. */}
      <label className={`${HALO} flex min-w-0 items-center justify-between gap-2 px-3 py-1.5`}>
        <span className="shrink-0 text-[0.625rem] leading-none font-semibold tracking-wide text-subtle uppercase sm:text-xs">Ordering</span>
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
            aria-label="Amount being ordered"
            className="-mr-1 w-full min-w-0 rounded-md bg-transparent px-1 text-right font-mono text-xl leading-none font-bold text-fg tabular-nums outline-none sm:text-2xl hover:bg-surface focus:bg-surface focus:ring-1 focus:ring-sky-400/60"
          />
        ) : (
          <span className="font-mono text-xl leading-none font-bold text-fg tabular-nums sm:text-2xl" title={info.grouped && editable ? "The sum of several systems' cards: change it on each card" : undefined}>
            {qty}
          </span>
        )}
      </label>
      {/* The delivery date, once the part is on the Order List. */}
      {(ORDER_STATUSES as readonly string[]).includes(status) && (canStatus || delivery) && (
        <label className={`${HALO} col-span-2 flex min-h-9 min-w-0 items-center justify-between gap-2 px-3 py-1`}>
          <span className={LABEL}>Delivery date</span>
          {canStatus ? (
            <input
              type="date"
              value={delivery ?? ""}
              onClick={(e) => e.currentTarget.showPicker?.()}
              onChange={(e) => {
                const next = e.target.value || null;
                setDelivery(next);
                // A date means it was ordered: a part not yet on its way moves to In Route.
                if (next && (BEFORE_IN_ROUTE as string[]).includes(status) && !statusDenied(mode, COTS_IN_ROUTE, { cots: true })) {
                  setStatus(COTS_IN_ROUTE);
                  onSave({ cotsDeliveryDate: next, status: COTS_IN_ROUTE });
                } else onSave({ cotsDeliveryDate: next });
              }}
              aria-label="Delivery date"
              title={late ? "Passed and the order isn't here yet" : undefined}
              className={`min-w-0 cursor-pointer rounded-md bg-transparent px-1 text-right text-sm font-bold tabular-nums ${late ? "text-rose-600 dark:text-rose-300" : "text-fg"} outline-none [color-scheme:light_dark] hover:bg-surface focus:bg-surface focus:ring-1 focus:ring-sky-400/60`}
            />
          ) : (
            <span className={`text-sm font-bold tabular-nums ${late ? "text-rose-600 dark:text-rose-300" : "text-fg"}`}>{delivery}</span>
          )}
        </label>
      )}
    </div>
  );
}
