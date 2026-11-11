"use client";

import { useState } from "react";
import type { SceneTools } from "./types";
import { isCylinder, type Cut, type DefaultPlane, type SectionView } from "./section";

const tool = "press inline-flex h-8 items-center justify-center rounded-md px-2 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg active:scale-[0.98] pointer-coarse:h-9 pointer-coarse:min-w-9";
const on = "bg-accent/15 text-accent-hover";
const DEFAULTS: { v: DefaultPlane; label: string }[] = [
  { v: "front", label: "Front" },
  { v: "top", label: "Top" },
  { v: "right", label: "Right" },
];

// Onshape's "Section view" panel, at the top left of the 3D view while it is open (Harel,
// 2026-11-11): the cuts picked on faces (a plane on a flat face, a cylinder on a round one, up to
// 3), each with its depth (a cylinder's radius), Flip and ✕; with none picked, the default plane.
// No help text, like Onshape's (Harel, 2026-11-11). ✓ closes it and keeps the cut; ✕ turns the
// section off. The row with the accent bar carries
// the 3D handle; a touch on a row moves it there. On phones each row also has a slider.
export function SectionDialog({ section, tools }: { section: SectionView; tools: SceneTools }) {
  const picked = section.planes.filter((c) => isCylinder(c) || c.from === "face").length;
  const set = (planes: Cut[]) => tools.section({ planes, open: section.open });
  const edit = (i: number, change: Partial<Cut>) => set(section.planes.map((p, k) => (k === i ? ({ ...p, ...change } as Cut) : p)));
  const remove = (i: number) => {
    const rest = section.planes.filter((_, k) => k !== i);
    if (rest.length) set(rest);
    else tools.sectionPlane("front"); // the last face cut gone: back to the default plane
  };
  const first = section.planes[0];
  const def = !picked && first && !isCylinder(first) ? first.from : null;
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
          const cyl = isCylinder(p) ? p : null;
          const plane = isCylinder(p) ? null : p;
          const value = cyl ? Math.round((cyl.radius + cyl.offset) * 10) / 10 : p.offset;
          const tilted = !!plane && (plane.tilt[0] !== 0 || plane.tilt[1] !== 0);
          const name = cyl ? `Cylinder on a ⌀${Math.round(cyl.radius * 20) / 10} mm face` : plane?.from === "face" ? "Plane on a face" : `${(plane?.from[0] ?? "").toUpperCase()}${plane?.from.slice(1)} plane`;
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
                <NumberField value={value} label={cyl ? "Section radius (mm)" : "Section depth (mm)"} prefix={cyl ? "R" : undefined} onChange={(n) => edit(i, { offset: cyl ? Math.max(0.1, n) - cyl.radius : n })} />
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
                aria-label={cyl ? "Section radius (mm)" : "Section depth (mm)"}
                className="hidden w-full accent-[var(--color-accent)] pointer-coarse:block pointer-coarse:h-8"
              />
              {tilted && (
                <div className="flex items-center gap-1 text-muted tabular-nums">
                  Tilted {plane!.tilt[0]}° · {plane!.tilt[1]}°
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

// A number in mm, typed: kept as text while typing ("-", "1.") and sent when it reads as a number.
function NumberField({ value, onChange, label, prefix }: { value: number; onChange: (v: number) => void; label: string; prefix?: string }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  return (
    <label className="flex items-center gap-1 px-1 text-muted tabular-nums">
      {prefix}
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
          if (e.target.value.trim() && Number.isFinite(n)) onChange(n);
        }}
        aria-label={label}
        className="h-8 w-16 rounded border border-line bg-surface px-1.5 text-right text-xs text-fg tabular-nums pointer-coarse:h-9"
      />
      mm
    </label>
  );
}
