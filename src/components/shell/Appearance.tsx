"use client";

import { useEffect, useRef, useState } from "react";
import { ShadeSlider } from "./ShadeSlider";
import { APPEARANCE_KEY as KEY, DEFAULT_HUE } from "./boot-scripts";

// Card size and site colour, set from the right panel and kept in this browser, so every page
// opens the way the member left it. Both live on <html>: --card-scale sizes the part card
// grids (.card-grid) and list views (.list-stack), and data-hue + --hue turn the accent colours (globals.css).
// Ctrl + mouse wheel (or a trackpad pinch) over a card grid or list moves the card size too, and so does a
// two-finger pinch on a phone; over a table it zooms that table instead (SheetViewport). Shift +
// wheel over cards sets their text size (--card-text, Harel 2026-11-08). Wheel notches glide to
// the new size instead of jumping.

type Prefs = { scale: number; hue: number; text: number };
const DEFAULTS: Prefs = { scale: 1, hue: DEFAULT_HUE, text: 1 };
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;
const MIN_TEXT = 0.7;
const MAX_TEXT = 1.8;
const GRIDS = ".card-grid, .category-grid, .list-stack";

// A window (like the workshop map) is open over the cards, or the gesture is inside one: its
// own zoom wins and the cards behind it stay the same size. A dialog opened from a card row
// still sits inside that row in the DOM, so .closest(GRIDS) alone would match it.
const inDialog = (target: EventTarget | null) =>
  !!document.querySelector("dialog[open]") || !!(target as Element | null)?.closest?.("dialog, [role=dialog]");
const clamp = (n: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, n)) * 1000) / 1000;
const clampScale = (n: number) => clamp(n, MIN_SCALE, MAX_SCALE);
const clampText = (n: number) => clamp(n, MIN_TEXT, MAX_TEXT);

function apply({ scale, hue, text }: Prefs) {
  const root = document.documentElement;
  root.style.setProperty("--card-scale", String(scale));
  if (text === 1) root.style.removeProperty("--card-text");
  else root.style.setProperty("--card-text", String(text));
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

  // Ctrl + wheel over cards sets the card size, Shift + wheel their text size: a notch is about 8%,
  // a pinch moves smoothly. Each wheel event moves a target and the shown size eases toward it a
  // frame at a time, so a mouse's notches glide instead of jumping. Elsewhere the browser's own
  // zoom (and Shift's sideways scroll) keeps working.
  useEffect(() => {
    const target = { scale: latest.current.scale, text: latest.current.text };
    let frame = 0;
    const glide = () => {
      const p = latest.current;
      const near = (a: number, b: number) => Math.abs(a - b) < 0.002;
      const next = {
        ...p,
        scale: near(p.scale, target.scale) ? target.scale : p.scale + (target.scale - p.scale) * 0.3,
        text: near(p.text, target.text) ? target.text : p.text + (target.text - p.text) * 0.3,
      };
      latest.current = next;
      apply(next);
      if (next.scale === target.scale && next.text === target.text) {
        frame = 0;
        setPrefs(next);
        persist(next);
      } else frame = requestAnimationFrame(glide);
    };
    const onWheel = (e: WheelEvent) => {
      if ((!e.ctrlKey && !e.shiftKey) || inDialog(e.target) || !(e.target as Element | null)?.closest?.(GRIDS)) return;
      e.preventDefault();
      // Shift turns a wheel's turn into a sideways one in some browsers.
      const delta = e.deltaY || e.deltaX;
      const step = Math.max(-0.15, Math.min(0.15, -delta * (e.deltaMode === 1 ? 0.03 : 0.0008)));
      // Start from where the size is headed (or, after a slider move, where it is).
      if (!frame) Object.assign(target, { scale: latest.current.scale, text: latest.current.text });
      if (e.ctrlKey) target.scale = clampScale(target.scale * (1 + step));
      else target.text = clampText(target.text * (1 + step));
      if (!frame) frame = requestAnimationFrame(glide);
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Two fingers on a card grid (phones): spreading them grows the cards, pinching shrinks them,
  // in step with the fingers, instead of zooming the page.
  useEffect(() => {
    let pinch: { dist: number; scale: number } | null = null;
    const gap = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 2 || inDialog(e.target) || !(e.target as Element | null)?.closest?.(GRIDS)) return;
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
      <label className="block">
        <span className="mb-1 flex items-center justify-between text-xs font-semibold text-muted">
          <span title="Shift + wheel over cards">Card text</span>
          <span className="flex items-center gap-2">
            {prefs.text !== 1 && (
              <button type="button" onClick={() => update({ text: 1 })} className="press text-[11px] font-medium text-subtle hover:text-fg">
                Reset
              </button>
            )}
            <span className="font-mono tabular-nums text-subtle">{Math.round(prefs.text * 100)}%</span>
          </span>
        </span>
        <input
          type="range"
          min={MIN_TEXT}
          max={MAX_TEXT}
          step={0.01}
          value={prefs.text}
          onChange={(e) => update({ text: Number(e.target.value) })}
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
