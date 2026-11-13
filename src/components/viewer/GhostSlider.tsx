"use client";

import { useState } from "react";
import type { SceneTools } from "./types";

// Isolate's ghost slider (Harel, 2026-11-13), in place of the menu's Show others as ghosts: 0 is
// no ghosts; further right, the other parts show see-through farther round the isolated ones, the
// nearest clearer (ghosts.ts). Shown on every 3D view while parts are isolated.
export function GhostSlider({ tools }: { tools: SceneTools }) {
  const [value, setValue] = useState(() => tools.ghosts());
  return (
    <label className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 animate-pop items-center gap-2 rounded-full border border-line bg-surface/95 px-3 py-1 text-xs font-semibold text-muted shadow-sm backdrop-blur max-sm:top-15 pointer-coarse:py-1.5" title="Show the other parts as see-through ghosts round the isolated ones">
      Ghosts
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => {
          const s = Number(e.target.value) / 100;
          setValue(s);
          tools.setGhosts(s);
        }}
        className="h-1 w-28 cursor-pointer accent-accent pointer-coarse:h-6 sm:w-36"
        aria-label="Ghosts round the isolated parts"
      />
    </label>
  );
}
