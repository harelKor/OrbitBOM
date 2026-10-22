"use client";

import { useSyncExternalStore } from "react";
import { ILS_PER_USD } from "@/config/cots";

// Dollars or shekels for every COTS price, remembered in this browser. One card's $/₪ button
// switches them all.
export type Currency = "usd" | "ils";

const KEY = "orbit-cots-currency";
const listeners = new Set<() => void>();

function read(): Currency {
  try {
    return localStorage.getItem(KEY) === "ils" ? "ils" : "usd";
  } catch {
    return "usd";
  }
}

export function setCurrency(c: Currency) {
  try {
    localStorage.setItem(KEY, c);
  } catch {
    // Private windows may refuse; the switch still holds for this page.
  }
  current = c;
  listeners.forEach((l) => l());
}

let current: Currency | null = null;

export function useCurrency(): Currency {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (current ??= read()),
    () => "usd",
  );
}

export function formatPrice(usd: number, currency: Currency) {
  const value = currency === "ils" ? usd * ILS_PER_USD : usd;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency === "ils" ? "ILS" : "USD", maximumFractionDigits: 2 }).format(value);
}
