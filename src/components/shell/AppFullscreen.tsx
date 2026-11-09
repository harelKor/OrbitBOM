"use client";

import { useEffect } from "react";

// The app installed on a PC opens full screen, as F11 would (Harel, 2026-11-09). Browsers only allow
// that from a click or key press, so it happens on the first one after the app opens, once per
// window (F11 or holding Esc leaves it, and it stays left). While full screen, Esc stays the app's
// (it closes windows and side panels) through the keyboard lock; holding it leaves full screen.
const KEY = "orbit-app-fullscreen";

type KeyboardLock = { lock?: (keys: string[]) => Promise<void> };

export function AppFullscreen() {
  useEffect(() => {
    const installedPc = matchMedia("(display-mode: window-controls-overlay), (display-mode: standalone)").matches && matchMedia("(pointer: fine)").matches;
    if (!installedPc || !document.fullscreenEnabled) return;
    try {
      if (sessionStorage.getItem(KEY)) return;
    } catch {}
    const go = (e: Event) => {
      // Esc doesn't count as a press that may open full screen.
      if (e instanceof KeyboardEvent && (e.key === "Escape" || e.key === "F11")) return;
      if (document.fullscreenElement) return stop();
      document.documentElement
        .requestFullscreen({ navigationUI: "hide" })
        .then(() => {
          stop();
          try {
            sessionStorage.setItem(KEY, "1");
          } catch {}
          (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard?.lock?.(["Escape"]).catch(() => {});
        })
        .catch(() => {});
    };
    const stop = () => {
      window.removeEventListener("pointerdown", go, true);
      window.removeEventListener("keydown", go, true);
    };
    window.addEventListener("pointerdown", go, true);
    window.addEventListener("keydown", go, true);
    return stop;
  }, []);
  return null;
}
