"use client";

import { useSyncExternalStore } from "react";

// A small choice (a page's Cards / List view) remembered by this browser. Works without storage
// too, for the rest of the visit. Null on the server and until the browser has one.
const listeners = new Set<() => void>();
const memory = new Map<string, string>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const read = (key: string) => {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export function useStoredChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const saved = useSyncExternalStore(subscribe, () => read(key), () => null);
  const value = allowed.includes(saved as T) ? (saved as T) : fallback;
  const set = (v: T) => {
    memory.set(key, v);
    try {
      localStorage.setItem(key, v);
    } catch {}
    listeners.forEach((fn) => fn());
  };
  return [value, set];
}
