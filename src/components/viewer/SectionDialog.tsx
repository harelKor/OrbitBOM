"use client";

import { useState } from "react";
import type { SceneTools } from "./types";
import { type Cut, type DefaultPlane, type SectionView } from "./section";
import { useUnits } from "./units";
import type { Units } from "@/lib/model/measure";

const tool = "press inline-flex h-8 items-center justify-center rounded-md px-2 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg active:scale-[0.98] pointer-coarse:h-9 pointer-coarse:min-w-9";
const on = "bg-accent/15 text-accent-hover";
const DEFAULTS: { v: DefaultPlane; label: string }[] = [
  { v: "front", label: "Front" },
  { v: "top", label: "Top" },
  { v: "right", label: "Right" },
];

// Onshape's "Section view" panel, at the top left of the 3D view while it is open (Harel,
// 2026-11-11): the planes picked on faces (on a flat face, or through a round face's axis, up to
// 3), each with its depth, Flip and ✕; with none picked, the default plane.
// No help text, like Onshape's (Harel, 2026-11-11). ✓ closes it and keeps the cut; ✕ turns the
// section off. The row with the accent bar carries
// the 3D handle; a touch on a row moves it there. On phones each row also has a slider.
export function SectionDialog({ section, tools }: { section: SectionView; tools: SceneTools }) {
  const units = useUnits();
  const picked = section.planes.filter((c) => c.from === "face").length;
  const set = (planes: Cut[]) => tools.section({ planes, open: section.open });
  const edit = (i: number, change: Partial<Cut>) => set(section.planes.map((p, k) => (k === i ? ({ ...p, ...change } as Cut) : p)));
  const remove = (i: number) => {
    const rest = section.planes.filter((_, k) => k !== i);
    if (rest.length) set(rest);
    else tools.sectionPlane("front"); // the last face cut gone: back to the default plane
  };
  const first = section.planes[0];
  const def = !picked && first ? first.from : null;
  return (
    <div
      role="dialog"
      aria-label="Section view"
      className="absolute top-3 left-3 z-30 flex w-[min(20rem,calc(100%-1.5rem))] animate-pop flex-col rounded-md border border-line bg-surface/95 text-xs shadow-md backdrop-blur"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1 border-b border-line py-1 pr-1 pl-2.5">
        <h2 className="flex-1 text-sm font-semibold text-fg">Section view</h2>
        <button className={`${tool} text-base text-accent-hover`} onClick={() => tools.sectionClose()} aria-label="Done (keep the section)" title="Done: keep the section">
          ✓
        </button>
        <button className={tool} onClick={() => tools.sectionShow(false)} aria-label="Turn off section view" title="Turn off section view">
          ✕
        </button>
      </div>
      <div className="flex flex-col gap-1 p-1">
        {def && (
          <div className="flex items-center gap-0.5 px-1">
            <span className="mr-auto text-muted">Default plane</span>
            {DEFAULTS.map(({ v, label }) => (
              <button key={v} className={`${tool} ${def === v ? on : ""}`} aria-pressed={def === v} onClick={() => tools.sectionPlane(v)}>
                {label}
              </button>
            ))}
          </div>
        )}
        {section.planes.map((p, i) => {
          const [lo, hi] = section.ranges[i] ?? [-100, 100];
          const tilted = p.tilt[0] !== 0 || p.tilt[1] !== 0;
          const name = p.from === "face" ? "Plane on a face" : `${p.from[0].toUpperCase()}${p.from.slice(1)} plane`;
          return (
            <div
              key={i}
              onPointerDown={() => i !== section.active && tools.sectionActive(i)}
              className={`flex flex-col gap-0.5 rounded border-l-2 py-0.5 pl-1.5 ${i === section.active ? "border-accent bg-raised/40" : "border-transparent"}`}
            >
              <div className="flex items-center gap-0.5">
                <span className="min-w-0 flex-1 truncate text-fg-2" title={name}>
                  {name}
                </span>
                <NumberField value={p.offset} units={units} label="Section depth" onChange={(n) => edit(i, { offset: n })} />
                <button className={`${tool} ${p.flip ? on : ""}`} aria-pressed={p.flip} onClick={() => edit(i, { flip: !p.flip })} title="Keep the other side">
                  Flip
                </button>
                {(picked > 0 || section.planes.length > 1) && (
                  <button className={tool} onClick={() => remove(i)} aria-label="Remove this cut" title="Remove this cut">
                    ✕
                  </button>
                )}
              </div>
              <input
                type="range"
                min={Math.min(lo, p.offset)}
                max={Math.max(hi, p.offset)}
                step={0.5}
                value={p.offset}
                onChange={(e) => edit(i, { offset: Number(e.target.value) })}
                aria-label="Section depth (mm)"
                className="hidden w-full accent-[var(--color-accent)] pointer-coarse:block pointer-coarse:h-8"
              />
              {tilted && (
                <div className="flex items-center gap-1 text-muted tabular-nums">
                  Tilted {p.tilt[0]}° · {p.tilt[1]}°
                  <button className={`${tool} ml-auto`} onClick={() => edit(i, { tilt: [0, 0] })}>
                    Level
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A length in mm shown in the view's units (inches: 3 decimals, like Onshape's), rounded.
const shown = (mm: number, units: Units) => (units === "in" ? Math.round((mm / 25.4) * 1000) / 1000 : Math.round(mm * 10) / 10);

// A length typed in the view's units, sent in mm: kept as text while typing ("-", "1.") and sent
// when it reads as a number.
function NumberField({ value: mm, units, onChange, label }: { value: number; units: Units; onChange: (mm: number) => void; label: string }) {
  const value = units === "in" ? shown(mm, units) : mm;
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  return (
    <label className="flex items-center gap-1 px-1 text-muted tabular-nums">
      <input
        type="text"
        inputMode="decimal"
        value={focused ? text : String(value)}
        onFocus={() => {
          setText(String(value));
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(",", "."));
          if (e.target.value.trim() && Number.isFinite(n)) onChange(units === "in" ? n * 25.4 : n);
        }}
        aria-label={`${label} (${units})`}
        className="h-8 w-16 rounded border border-line bg-surface px-1.5 text-right text-xs text-fg tabular-nums pointer-coarse:h-9"
      />
      {units}
    </label>
  );
}
