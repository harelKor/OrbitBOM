"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/Icon";

// Light / dark. Starts from the device setting; a click saves the choice in this browser.
const KEY = "orbit-theme";

function current(): "light" | "dark" {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, current, () => "light" as const);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(KEY, next);
        } catch {}
        listeners.forEach((fn) => fn());
      }}
      className="press flex h-8 w-8 items-center justify-center rounded-md border border-white/30 hover:bg-white/10"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}

// Runs before the page paints so a saved theme never flashes the other one.
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
