"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/Icon";
import { SHADE_KEY as KEY } from "./boot-scripts";

// Light to dark as a greyscale slider: 0 is the white theme, 100 the dark one, and every step
// between greys the page, cards and lines (globals.css, data-shade). Text and accents follow the
// nearer theme. Starts from the device setting; a move saves the shade in this browser.

function current(): number {
  const set = document.documentElement.dataset.shade;
  if (set) return Number(set);
  return matchMedia("(prefers-color-scheme: dark)").matches ? 100 : 0;
}

const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  const mq = matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", fn);
  return () => {
    listeners.delete(fn);
    mq.removeEventListener("change", fn);
  };
}

export function ShadeSlider() {
  const shade = useSyncExternalStore(subscribe, current, () => 0);
  return (
    <label className="flex items-center gap-1.5" title="Light to dark">
      <Icon name="sun" className="h-4 w-4 opacity-80" />
      <input
        type="range"
        min={0}
        max={100}
        value={shade}
        onChange={(e) => {
          const n = Number(e.target.value);
          const root = document.documentElement;
          root.dataset.shade = String(n);
          root.dataset.theme = n >= 50 ? "dark" : "light";
          root.style.setProperty("--shade", `${n}%`);
          try {
            localStorage.setItem(KEY, String(n));
          } catch {}
          listeners.forEach((fn) => fn());
        }}
        aria-label="Light to dark"
        className="shade-slider w-20 md:w-24"
      />
      <Icon name="moon" className="h-4 w-4 opacity-80" />
    </label>
  );
}
