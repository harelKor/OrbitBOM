"use client";

// The 3D view's length units, mm or inch, like Onshape's units setting (S9): Measure and the
// Section panel show them. Kept per browser; every open view follows a change at once.
import { useSyncExternalStore } from "react";
import type { Units } from "@/lib/model/measure";

const STORE = "viewer-units";
const listeners = new Set<() => void>();

function read(): Units {
  try {
    return localStorage.getItem(STORE) === "in" ? "in" : "mm";
  } catch {
    return "mm";
  }
}

export function setUnits(u: Units) {
  try {
    localStorage.setItem(STORE, u);
  } catch {}
  listeners.forEach((f) => f());
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  const onStorage = (e: StorageEvent) => e.key === STORE && f();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(f);
    window.removeEventListener("storage", onStorage);
  };
};

export const useUnits = (): Units => useSyncExternalStore(subscribe, read, () => "mm");

// The mm / in switch, small, for the measure box and the cube menu.
export function UnitsSwitch({ className = "" }: { className?: string }) {
  const units = useUnits();
  const opt = (u: Units, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={units === u}
      onClick={() => setUnits(u)}
      className={`press rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold active:scale-[0.98] pointer-coarse:min-h-9 pointer-coarse:px-2.5 ${units === u ? "bg-accent/15 text-accent-hover" : "text-subtle hover:bg-raised hover:text-fg"}`}
    >
      {label}
    </button>
  );
  return (
    <span role="radiogroup" aria-label="Units" className={`inline-flex items-center gap-0.5 ${className}`}>
      {opt("mm", "mm")}
      {opt("in", "in")}
    </span>
  );
}
