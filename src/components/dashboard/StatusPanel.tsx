"use client";

import { useState } from "react";
import { useSidePanels } from "@/components/shell/SidePanels";
import { Icon } from "@/components/ui/Icon";

// The robot dashboard's status box, folding sideways on a bigger page: folded, it's a thin strip
// and the 3D view takes the room. It starts open, and folded while both side columns are open,
// until the member folds or opens it themselves (Harel, 2026-11-07). On smaller pages it's always
// open, stacked with the rest.
export function StatusPanel({ percent, children }: { percent: number; children: React.ReactNode }) {
  const panels = useSidePanels();
  const both = panels.left && panels.right;
  // The member's own choice, for the side columns as they were when they made it.
  const [chosen, setChosen] = useState<{ open: boolean; both: boolean } | null>(null);
  const open = chosen && chosen.both === both ? chosen.open : !both;
  const set = (o: boolean) => setChosen({ open: o, both });

  return (
    <section className={`@container panel relative max-md:hidden @5xl:min-h-0 @5xl:transition-[width] @5xl:duration-200 ${open ? "p-4 @5xl:w-[34cqw] @5xl:overflow-y-auto @min-[100rem]:w-[27cqw]" : "p-4 @5xl:w-14 @5xl:p-0"}`}>
      {open ? (
        <>
          <button
            type="button"
            onClick={() => set(false)}
            className="press absolute top-2 right-2 z-[1] hidden h-9 w-9 items-center justify-center rounded-md text-subtle hover:bg-raised hover:text-fg @5xl:flex"
            aria-label="Fold the status box"
            title="Fold: more room for the 3D view"
          >
            <Icon name="chevron" className="h-5 w-5 rotate-180" />
          </button>
          <div className="space-y-5">{children}</div>
        </>
      ) : (
        <>
          {/* Folded only on a bigger page: below that the box shows as usual. */}
          <div className="space-y-5 @5xl:hidden">{children}</div>
          <button
            type="button"
            onClick={() => set(true)}
            className="press hidden h-full w-full flex-col items-center gap-3 py-4 text-subtle hover:text-fg @5xl:flex"
            aria-label="Open the status box"
            title="Open the status box"
          >
            <Icon name="chevron" className="h-5 w-5" />
            <span className="font-semibold text-fg-2 [writing-mode:vertical-rl]">Status</span>
            <span className="display text-sm text-accent tabular-nums [writing-mode:vertical-rl]">{percent}%</span>
          </button>
        </>
      )}
    </section>
  );
}
