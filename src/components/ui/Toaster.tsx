"use client";

import { useEffect, useState } from "react";

const TOAST_EVENT = "orbit:toast";

// A short message at the bottom of the screen (Undo, Redo, Recent actions' Revert).
export function toast(text: string, error = false) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { text, error } }));
}

export function Toaster() {
  const [shown, setShown] = useState<{ text: string; error: boolean; id: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      const { text, error } = (e as CustomEvent<{ text: string; error: boolean }>).detail;
      setShown({ text, error, id: Date.now() });
      clearTimeout(timer);
      timer = setTimeout(() => setShown(null), 5000);
    };
    window.addEventListener(TOAST_EVENT, on);
    return () => {
      window.removeEventListener(TOAST_EVENT, on);
      clearTimeout(timer);
    };
  }, []);
  if (!shown) return null;
  return (
    <div
      key={shown.id}
      role="status"
      className={`fixed bottom-5 left-1/2 z-50 max-w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg ${
        shown.error ? "bg-rose-600" : "bg-[#111318]/90"
      }`}
    >
      {shown.text}
    </div>
  );
}
