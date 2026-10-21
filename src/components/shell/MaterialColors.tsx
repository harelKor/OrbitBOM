"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { setMaterialColor } from "@/app/(app)/material-colors-actions";
import { DEFAULT_MATERIAL_COLORS, MATERIAL_COLOR_GROUPS } from "@/config/materialColors";
import { useEditMode } from "./ModeContext";

// The team's material colours (changed ones only), shared by the right panel's editor and
// every 3D view's Material mode.
const MaterialColorsContext = createContext<{ overrides: Record<string, string>; set: (category: string, color: string | null) => void }>({
  overrides: {},
  set: () => {},
});

export function MaterialColorsProvider({ initial, children }: { initial: Record<string, string>; children: React.ReactNode }) {
  const [overrides, setOverrides] = useState(initial);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  // Dragging in the colour picker fires on every move: show it at once, save once it settles.
  const set = (category: string, color: string | null) => {
    setOverrides((o) => {
      const next = { ...o };
      if (color === null) delete next[category];
      else next[category] = color;
      return next;
    });
    clearTimeout(timers.current.get(category));
    timers.current.set(
      category,
      setTimeout(() => void setMaterialColor(category, color), 400),
    );
  };
  return <MaterialColorsContext.Provider value={{ overrides, set }}>{children}</MaterialColorsContext.Provider>;
}

export const useMaterialColors = () => useContext(MaterialColorsContext).overrides;

// The right panel's list: a swatch per material category, a colour picker on each in Edit mode.
export function MaterialColorsPanel() {
  const { overrides, set } = useContext(MaterialColorsContext);
  const edit = useEditMode();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only preference
      setOpen(localStorage.getItem("orbit-material-colors") === "open");
    } catch {}
  }, []);
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem("orbit-material-colors", next ? "open" : "closed");
    } catch {}
  };

  return (
    <details open={open} onToggle={(e) => toggle(e.currentTarget.open)} className="border-t border-line p-2 text-sm">
      <summary className="cursor-pointer px-1 py-1 text-xs font-semibold text-muted">Material colors</summary>
      <ul className="mt-1 space-y-0.5">
        {MATERIAL_COLOR_GROUPS.map((category) => {
          const color = overrides[category] ?? DEFAULT_MATERIAL_COLORS[category];
          return (
            <li key={category} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-raised">
              {edit ? (
                <input
                  type="color"
                  value={color}
                  onChange={(e) => set(category, e.target.value)}
                  aria-label={`${category} colour`}
                  className="press h-5 w-5 shrink-0 cursor-pointer rounded border border-line-strong bg-transparent p-0 [&::-webkit-color-swatch]:rounded-[3px] [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
                />
              ) : (
                <span className="h-5 w-5 shrink-0 rounded border border-line-strong" style={{ background: color }} />
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-fg-2">{category}</span>
              {edit && overrides[category] && (
                <button onClick={() => set(category, null)} className="press text-[11px] text-subtle hover:text-fg" title="Back to the default colour">
                  Reset
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
