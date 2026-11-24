"use client";

import { useState } from "react";

// The amount to order on an order page's card, row and table cell (Harel, 2026-11-24): bright, so
// it is the first thing read, and a tap types a new one, apart from the part's quantity and the
// item's season need. Emptying it (or ↺) goes back to the worked-out amount (orderAmount in
// lib/cots.ts). `typed`: a member typed this one.
export type AmountProps = { value: number; typed: boolean; onChange?: (n: number | null) => void };

export function OrderAmount({ value, typed, onChange, size = "md" }: AmountProps & { size?: "sm" | "md" }) {
  const [text, setText] = useState<string | null>(null);
  const done = () => {
    if (text === null) return;
    setText(null);
    if (text === "") return typed && onChange?.(null);
    const n = Math.min(100000, Math.max(0, Math.round(Number(text))));
    if (Number.isFinite(n) && (n !== value || !typed)) onChange?.(n);
  };
  const sm = size === "sm";
  const box = `inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-300 font-bold text-amber-950 shadow-[0_0_14px_-3px_rgba(251,191,36,0.75)] ring-1 ring-amber-500/70 ${
    sm ? "px-2 py-0.5" : "px-2.5 py-1 pointer-coarse:min-h-9"
  }`;
  const label = <span className={`leading-none tracking-wide uppercase ${sm ? "text-[0.5625rem]" : "text-[0.625rem]"}`}>To order</span>;
  const number = `font-mono leading-none tabular-nums ${sm ? "text-sm" : "text-lg"}`;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  if (!onChange)
    return (
      <span className={box}>
        {label}
        <span className={number}>{value}</span>
      </span>
    );
  return (
    <span className="inline-flex shrink-0 items-center gap-1" onClick={stop} onPointerDown={stop}>
      {text === null ? (
        <button type="button" onClick={() => setText(String(value))} className={`press ${box} hover:bg-amber-200 active:scale-[0.98]`} title={typed ? "Typed on the order pages: tap to change it" : "Tap to type how many to order"} aria-label={`To order: ${value}. Change it`}>
          {label}
          <span className={number}>{value}</span>
          {typed && <span className="text-[0.625rem] opacity-70">✎</span>}
        </button>
      ) : (
        <label className={box}>
          {label}
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={done}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setText(null);
            }}
            onFocus={(e) => e.currentTarget.select()}
            inputMode="numeric"
            aria-label="How many to order"
            className={`${number} w-14 rounded bg-white/70 px-1 text-right text-amber-950 outline-none focus:ring-1 focus:ring-amber-600`}
          />
        </label>
      )}
      {typed && text === null && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="press flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-surface text-xs text-muted hover:text-fg pointer-coarse:h-9 pointer-coarse:w-9"
          title="Back to the worked-out amount"
          aria-label="Back to the worked-out amount"
        >
          ↺
        </button>
      )}
    </span>
  );
}
