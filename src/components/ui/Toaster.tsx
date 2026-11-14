"use client";

import { useEffect, useState } from "react";
import { TopLayer } from "./TopLayer";

const TOAST_EVENT = "orbit:toast";

// A short message at the bottom of the screen (Undo, Redo, Recent actions' Revert, failed saves).
// Errors stay until tapped, so one raised while you looked away is still there to read.
export function toast(text: string, error = false) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { text, error } }));
}

type Shown = { text: string; error: boolean; id: number };

export function Toaster() {
  const [shown, setShown] = useState<Shown[]>([]);
  useEffect(() => {
    let next = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const on = (e: Event) => {
      const { text, error } = (e as CustomEvent<{ text: string; error: boolean }>).detail;
      const id = ++next;
      // A new message replaces the passing ones; errors stay (the newest three) until tapped.
      setShown((s) => [...s.filter((t) => t.error && t.text !== text).slice(-2), { text, error, id }]);
      if (!error) {
        const timer = setTimeout(() => {
          timers.delete(timer);
          setShown((s) => s.filter((t) => t.id !== id));
        }, 5000);
        timers.add(timer);
      }
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => {
      window.removeEventListener(TOAST_EVENT, on);
      for (const t of timers) clearTimeout(t);
    };
  }, []);
  if (!shown.length) return null;
  return (
    <TopLayer className="bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 flex w-max max-w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 flex-col items-center gap-2">
      {shown.map((t) =>
        t.error ? (
          <button
            key={t.id}
            type="button"
            role="alert"
            onClick={() => setShown((s) => s.filter((x) => x.id !== t.id))}
            className="flex min-h-10 animate-pop items-center gap-3 rounded-lg bg-rose-600 py-2 pr-2 pl-4 text-left text-sm font-medium text-white shadow-lg active:scale-[0.98]"
          >
            <span className="min-w-0">{t.text}</span>
            <span aria-label="Dismiss" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15">
              ✕
            </span>
          </button>
        ) : (
          <div key={t.id} role="status" className="animate-pop rounded-lg bg-[#111318]/90 px-4 py-2.5 text-sm font-medium text-white shadow-lg dark:bg-[#2a3042]/95">
            {t.text}
          </div>
        ),
      )}
    </TopLayer>
  );
}
