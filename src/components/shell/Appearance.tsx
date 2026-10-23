"use client";

import { useEffect, useState } from "react";

// Card size and site colour, set from the right panel and kept in this browser, so every page
// opens the way the member left it. Both live on <html>: --card-scale sizes the part card
// grids (.card-grid) and zooms the tables (.data-table), and data-hue + --hue turn the accent colours (globals.css).
const KEY = "orbit-appearance";
export const DEFAULT_HUE = 264; // Orbit blue, #0000cc

type Prefs = { scale: number; hue: number };
const DEFAULTS: Prefs = { scale: 1, hue: DEFAULT_HUE };

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

export function AppearanceControls() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only preference
      if (saved) setPrefs({ ...DEFAULTS, ...saved });
    } catch {}
  }, []);
  const update = (next: Partial<Prefs>) => {
    const p = { ...prefs, ...next };
    setPrefs(p);
    apply(p);
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {}
  };

  return (
    <div className="space-y-3 border-t border-line p-3">
      <label className="block">
        <span className="mb-1 flex items-center justify-between text-xs font-semibold text-muted">
          Card size
          <span className="font-mono text-subtle">{Math.round(prefs.scale * 100)}%</span>
        </span>
        <input
          type="range"
          min={0.3}
          max={2.5}
          step={0.05}
          value={prefs.scale}
          onChange={(e) => update({ scale: Number(e.target.value) })}
          className="w-full accent-accent"
        />
      </label>
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

// Runs before the page paints, next to the theme script, so the saved size and colour never flash.
export const APPEARANCE_SCRIPT = `try{var a=JSON.parse(localStorage.getItem("${KEY}")||"null");if(a){var r=document.documentElement;if(a.scale)r.style.setProperty("--card-scale",a.scale);if(a.hue!=null&&a.hue!==${DEFAULT_HUE}){r.dataset.hue="";r.style.setProperty("--hue",a.hue)}}}catch(e){}`;
