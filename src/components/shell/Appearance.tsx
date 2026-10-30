"use client";

import { useEffect, useRef, useState } from "react";
import { ShadeSlider } from "./ShadeSlider";
import { APPEARANCE_KEY as KEY, DEFAULT_HUE } from "./boot-scripts";

// Card size and site colour, set from the right panel and kept in this browser, so every page
// opens the way the member left it. Both live on <html>: --card-scale sizes the part card
// grids (.card-grid), and data-hue + --hue turn the accent colours (globals.css).
// Ctrl + mouse wheel (or a trackpad pinch) over a card grid moves the card size too, and so does a
// two-finger pinch on a phone; over a table it zooms that table instead (SheetViewport).

type Prefs = { scale: number; hue: number };
const DEFAULTS: Prefs = { scale: 1, hue: DEFAULT_HUE };
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;
const GRIDS = ".card-grid, .category-grid";
const clampScale = (n: number) => Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, n)) * 1000) / 1000;

function apply({ scale, hue }: Prefs) {
  const root = document.documentElement;
  root.style.setProperty("--card-scale", String(scale));
  if (hue === DEFAULT_HUE) {
    delete root.dataset.hue;
    root.style.removeProperty("--hue");
  } else {
    root.dataset.hue = "";
    root.style.setProperty("--hue", String(hue));
  }
}

function persist(p: Prefs) {
  apply(p);
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}

export function AppearanceControls() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  // The prefs as last set, for the wheel listener (state would be stale inside it).
  const latest = useRef(DEFAULTS);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (saved) setPrefs((latest.current = { ...DEFAULTS, ...saved }));
    } catch {}
  }, []);
  // Card size from a gesture: state and storage follow, skipped when nothing moved.
  const setScale = (n: number) => {
    const scale = clampScale(n);
    if (scale === latest.current.scale) return;
    latest.current = { ...latest.current, scale };
    setPrefs(latest.current);
    persist(latest.current);
  };
  const update = (next: Partial<Prefs>) => {
    const p = { ...latest.current, ...next };
    latest.current = p;
    setPrefs(p);
    persist(p);
  };

  // Ctrl + wheel over cards: a notch is about 8%, a pinch moves smoothly. Elsewhere
  // the browser's own zoom keeps working.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !(e.target as Element | null)?.closest?.(GRIDS)) return;
      e.preventDefault();
      const step = Math.max(-0.15, Math.min(0.15, -e.deltaY * (e.deltaMode === 1 ? 0.03 : 0.0008)));
      setScale(latest.current.scale * (1 + step));
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // Two fingers on a card grid (phones): spreading them grows the cards, pinching shrinks them,
  // in step with the fingers, instead of zooming the page.
  useEffect(() => {
    let pinch: { dist: number; scale: number } | null = null;
    const gap = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !(e.target as Element | null)?.closest?.(GRIDS)) return;
      e.preventDefault();
      pinch = { dist: gap(e.touches) || 1, scale: latest.current.scale };
    };
    const onMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      setScale(pinch.scale * (gap(e.touches) / pinch.dist));
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };
    window.addEventListener("touchstart", onStart, { passive: false });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return (
    <div className="space-y-3 border-t border-line p-3">
      <label className="block">
        <span className="mb-1 flex items-center justify-between text-xs font-semibold text-muted">
          Card size
          <span className="font-mono tabular-nums text-subtle">{Math.round(prefs.scale * 100)}%</span>
        </span>
        <input
          type="range"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step={0.01}
          value={prefs.scale}
          onChange={(e) => update({ scale: Number(e.target.value) })}
          className="w-full accent-accent"
        />
      </label>
      <ShadeSlider />
      <label className="block">
        <span className="mb-1 flex items-center justify-between text-xs font-semibold text-muted">
          Colour
          {prefs.hue !== DEFAULT_HUE && (
            <button type="button" onClick={() => update({ hue: DEFAULT_HUE })} className="press text-[11px] font-medium text-subtle hover:text-fg">
              Reset
            </button>
          )}
        </span>
        <input
          type="range"
          min={0}
          max={359}
          value={prefs.hue}
          onChange={(e) => update({ hue: Number(e.target.value) })}
          aria-label="Site colour"
          className="hue-slider w-full"
        />
      </label>
    </div>
  );
}
