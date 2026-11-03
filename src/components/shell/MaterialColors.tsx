"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import type { MaterialGroup } from "@/lib/data/materials";

// The team's material colours (changed ones only), for every 3D view's Material mode.
const MaterialColorsContext = createContext<Record<string, string>>({});

// The inventory items a part's material can be, by category (Raw Stock first), for every
// material picker. Fetched from /api/materials, not sent with the layout: kept for the whole
// visit and fetched again in the background whenever the layout renders anew (`stamp` changes
// after a save or a refresh), so pickers show the last list at once.
let materials: MaterialGroup[] = [];
let loadedStamp: number | null = null;
let inFlight: AbortController | null = null;
const listeners = new Set<() => void>();

function load(stamp: number) {
  if (loadedStamp === stamp) return;
  loadedStamp = stamp;
  inFlight?.abort();
  const ctrl = (inFlight = new AbortController());
  fetch("/api/materials", { signal: ctrl.signal })
    .then((r) => (r.ok ? (r.json() as Promise<MaterialGroup[]>) : null))
    .then((groups) => {
      if (!groups || ctrl.signal.aborted) return;
      materials = groups;
      listeners.forEach((l) => l());
    })
    .catch(() => {
      // A failed fetch keeps the last list; the next stamp tries again.
      if (loadedStamp === stamp) loadedStamp = null;
    });
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const NONE: MaterialGroup[] = [];

export function MaterialColorsProvider({ initial, stamp, children }: { initial: Record<string, string>; stamp: number; children: React.ReactNode }) {
  useEffect(() => load(stamp), [stamp]);
  return <MaterialColorsContext.Provider value={initial}>{children}</MaterialColorsContext.Provider>;
}

export const useMaterialColors = () => useContext(MaterialColorsContext);
export const useMaterials = () =>
  useSyncExternalStore(
    subscribe,
    () => materials,
    () => NONE,
  );
