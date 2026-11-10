"use client";

import { useState } from "react";
import type { Axis, HiddenParts, SceneTools, Section, ViewName } from "@/components/dashboard/ModelCanvas";

// The other views moved to the view cube, top right (S1, plan/cad-3d-viewer.md); Fit stays here,
// a big target on phones.
const VIEWS: { v: ViewName | "fit"; label: string }[] = [{ v: "fit", label: "Fit" }];
const tool = "press inline-flex h-8 items-center justify-center rounded-md px-2 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg active:scale-[0.98] pointer-coarse:h-9 pointer-coarse:min-w-9";
const on = "bg-accent/15 text-accent-hover";
const box = "rounded-md border border-line bg-surface/95 shadow-sm backdrop-blur";


// CAD's tools on the 3D view: standard views and fit, and one section plane. (Picking points, edges
// and faces to measure is always on: ReviewScreen shows the results.) Wide screens
// show them at the bottom left; phones fold them into a Tools button on the left, under Versions
// (Harel, 2026-11-09). Parts hidden with Y or Hide are listed below, folded behind a "Hidden" button.
export function ViewerToolbar({
  tools,
  children,
  hidden,
}: {
  tools: SceneTools | null;
  children?: React.ReactNode; // the colour toggle, above the tools
  hidden?: HiddenParts | null;
}) {
  const [section, setSection] = useState<Section | null>(null);
  const [open, setOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  const cut = (s: Section | null) => {
    setSection(s);
    tools?.section(s);
  };
  const folded = open ? "" : "max-lg:hidden";
  return (
    <div className="absolute left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2 max-lg:top-16 max-lg:max-h-[calc(100%-9rem)] max-lg:overflow-y-auto lg:bottom-3" onClick={(e) => e.stopPropagation()}>
      <button className={`${box} ${tool} h-10 px-3 text-sm lg:hidden ${open ? on : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        Tools {open ? "▴" : "▾"}
      </button>
      <div className={`flex flex-col items-start gap-2 ${folded}`}>{children}</div>
      {section && (
        <div className={`flex flex-wrap items-center gap-1 p-1 ${box} ${folded}`}>
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
      {tools && (
        <div className={`flex flex-wrap items-center gap-0.5 p-1 ${box} ${folded}`}>
          {VIEWS.map(({ v, label }) => (
            <button key={v} className={tool} onClick={() => tools.view(v)}>
              {label}
            </button>
          ))}
          <span className="mx-0.5 h-5 w-px bg-line" />
          <button className={`${tool} ${section ? on : ""}`} aria-pressed={!!section} onClick={() => cut(section ? null : { axis: "x", at: 0.5, flip: false })}>
            Section
          </button>
        </div>
      )}
      {hidden && (
        <div className={`flex w-48 flex-col overflow-hidden text-xs ${box}`}>
          <div className="flex items-center gap-2 px-1 py-0.5">
            <button className={`${tool} flex-1 justify-start tabular-nums`} aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>
              Hidden · {hidden.items.length} {showHidden ? "▴" : "▾"}
            </button>
            <button className={`${tool} text-accent-hover`} onClick={() => hidden.show(null)}>
              Show all
            </button>
          </div>
          {showHidden && (
            <ul className="max-h-48 overflow-y-auto border-t border-line p-1">
              {hidden.items.map((g) => (
                <li key={g.id}>
                  <button onClick={() => hidden.show(g.id)} title="Show it again" className="press block w-full truncate rounded px-2 py-1.5 text-left text-fg-2 hover:bg-raised hover:text-fg pointer-coarse:min-h-9">
                    {g.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
