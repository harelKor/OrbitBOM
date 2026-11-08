"use client";

import { useState } from "react";
import type { Axis, SceneTools, Section, ViewName } from "@/components/dashboard/ModelCanvas";

const VIEWS: { v: ViewName | "fit"; label: string }[] = [
  { v: "fit", label: "Fit" },
  { v: "iso", label: "Iso" },
  { v: "front", label: "Front" },
  { v: "top", label: "Top" },
  { v: "side", label: "Side" },
];
const tool = "press inline-flex h-8 items-center justify-center rounded-md px-2 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg active:scale-[0.98] pointer-coarse:h-9 pointer-coarse:min-w-9";
const on = "bg-accent/15 text-accent-hover";

// CAD Review's tools under the 3D view: standard views and fit, one section plane, and measuring
// between two points (≈: the meshes are exported at 0.5 mm, good for clearances, not tolerances).
export function ViewerToolbar({
  tools,
  measured,
  measuring,
  onMeasuring,
  children,
}: {
  tools: SceneTools | null;
  measured: { points: number; mm: number | null };
  measuring: boolean;
  onMeasuring: (on: boolean) => void;
  children?: React.ReactNode; // the colour toggle, above the tools
}) {
  const [section, setSection] = useState<Section | null>(null);
  const cut = (s: Section | null) => {
    setSection(s);
    tools?.section(s);
  };
  return (
    <div className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2" onClick={(e) => e.stopPropagation()}>
      {children}
      {section && (
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-line bg-surface/95 p-1 shadow-sm backdrop-blur">
          {(["x", "y", "z"] as Axis[]).map((a) => (
            <button key={a} className={`${tool} ${section.axis === a ? on : ""} uppercase`} onClick={() => cut({ ...section, axis: a })} aria-pressed={section.axis === a}>
              {a}
            </button>
          ))}
          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={section.at}
            onChange={(e) => cut({ ...section, at: Number(e.target.value) })}
            aria-label="Section position"
            className="w-32 accent-[var(--color-accent)] sm:w-44"
          />
          <button className={tool} onClick={() => cut({ ...section, flip: !section.flip })} title="Keep the other side">
            Flip
          </button>
        </div>
      )}
      {measuring && (
        <div role="status" className="rounded-md border border-rose-400/50 bg-surface/95 px-2.5 py-1.5 text-xs text-fg shadow-sm backdrop-blur tabular-nums">
          {measured.mm !== null ? <span className="font-semibold">≈ {measured.mm.toFixed(1)} mm</span> : measured.points === 1 ? "Tap the second point" : "Tap two points on the model"}
        </div>
      )}
      {tools && (
      <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-line bg-surface/95 p-1 shadow-sm backdrop-blur">
        {VIEWS.map(({ v, label }) => (
          <button key={v} className={tool} onClick={() => tools.view(v)}>
            {label}
          </button>
        ))}
        <span className="mx-0.5 h-5 w-px bg-line" />
        <button className={`${tool} ${section ? on : ""}`} aria-pressed={!!section} onClick={() => cut(section ? null : { axis: "x", at: 0.5, flip: false })}>
          Section
        </button>
        <button
          className={`${tool} ${measuring ? on : ""}`}
          aria-pressed={measuring}
          onClick={() => {
            tools.measure(!measuring);
            onMeasuring(!measuring);
          }}
        >
          Measure
        </button>
      </div>
      )}
    </div>
  );
}
