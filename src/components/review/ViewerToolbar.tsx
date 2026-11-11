"use client";

import { useState } from "react";
import type { HiddenParts, SceneTools } from "@/components/dashboard/ModelCanvas";

const tool = "press inline-flex h-8 items-center justify-center rounded-md px-2 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg active:scale-[0.98] pointer-coarse:h-9 pointer-coarse:min-w-9";
const on = "bg-accent/15 text-accent-hover";
const box = "rounded-md border border-line bg-surface/95 shadow-sm backdrop-blur";


// CAD's tools on the 3D view. The views, projection and section are in the view cube's menu, like
// Onshape (Harel, 2026-11-11); what stays here is the colours toggle, Fit on phones only (a big
// target there; F and the cube menu on a computer) and the hidden parts. (Picking points, edges and
// faces to measure is always on: ReviewScreen shows the results.) Wide screens show them at the
// bottom left; phones fold them into a Tools button on the left, under Versions (Harel,
// 2026-11-09). Parts hidden with Y or Hide are listed below, folded behind a "Hidden" button.
export function ViewerToolbar({
  tools,
  children,
  hidden,
}: {
  tools: SceneTools | null;
  children?: React.ReactNode; // the colour toggle, above the tools
  hidden?: HiddenParts | null;
}) {
  const [open, setOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const folded = open ? "" : "max-lg:hidden";
  return (
    <div className="absolute left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2 max-lg:top-16 max-lg:max-h-[calc(100%-9rem)] max-lg:overflow-y-auto lg:bottom-3" onClick={(e) => e.stopPropagation()}>
      <button className={`${box} ${tool} h-10 px-3 text-sm lg:hidden ${open ? on : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        Tools {open ? "▴" : "▾"}
      </button>
      <div className={`flex flex-col items-start gap-2 ${folded}`}>{children}</div>
      {tools && (
        <div className={`flex items-center p-1 lg:hidden ${box} ${folded}`}>
          <button className={tool} onClick={() => tools.view("fit")}>
            Fit
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
