"use client";

import { useState } from "react";
import { useSidePanels } from "@/components/shell/SidePanels";
import { Icon } from "@/components/ui/Icon";

// The robot dashboard's status box, folding sideways on a bigger page: folded, it's a narrow
// button box and the 3D view takes the room. It starts folded, side columns open or not, until the
// member opens it (Harel, 2026-11-12). On smaller pages it's always open, stacked with the rest.
// `@…/dash` sizes: the dashboard's width (its `@container/dash`), not this box's own. With both
// side columns open there's no room for it, so it's left out (phones keep their own Status
// section under Inventory) (Harel, 2026-11-12).
export function StatusPanel({ percent, done, total, children }: { percent: number; done: number; total: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const panels = useSidePanels();
  if (panels.left && panels.right) return null;

  if (open)
    return (
      <section className="@container panel relative p-4 max-md:hidden @3xl/dash:w-[34cqw] @3xl/dash:shrink-0 @5xl/dash:min-h-0 @5xl/dash:overflow-y-auto @min-[100rem]/dash:w-[27cqw]">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="press absolute top-2 right-2 z-[1] hidden h-9 w-9 items-center justify-center rounded-md border border-line bg-raised text-subtle hover:border-accent/50 hover:text-fg active:scale-[0.98] @3xl/dash:flex"
          aria-label="Fold the status box"
          title="Fold: more room for the 3D view"
        >
          <Icon name="chevron" className="h-5 w-5 rotate-180" />
        </button>
        <div className="space-y-5">{children}</div>
      </section>
    );

  return (
    <>
      {/* Folded only on a bigger page: below that the box shows as usual. */}
      <section className="@container panel space-y-5 p-4 max-md:hidden @3xl/dash:hidden">{children}</section>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="card-interactive group hidden w-20 shrink-0 flex-col items-center justify-between gap-4 px-2 py-5 active:scale-[0.98] @3xl/dash:flex"
        aria-label="Open the status box"
        title="Open the status box"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line-strong bg-raised text-accent-hover transition-colors group-hover:border-accent/60">
          <Icon name="chevron" className="h-5 w-5 transition-transform duration-150 group-hover:translate-x-0.5" />
        </span>
        <span className="text-lg font-bold tracking-wide text-fg-2 [writing-mode:vertical-rl] group-hover:text-fg">Status</span>
        <span className="flex flex-col items-center gap-1">
          <span className="display text-2xl text-accent tabular-nums">{percent}%</span>
          <span className="text-xs text-subtle tabular-nums">
            {done}/{total}
          </span>
        </span>
      </button>
    </>
  );
}
