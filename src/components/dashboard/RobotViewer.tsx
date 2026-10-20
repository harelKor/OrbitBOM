"use client";

import { useState } from "react";
import type { StatusCount } from "@/lib/stats";
import { Segmented } from "@/components/ui/Segmented";
import { Icon } from "@/components/ui/Icon";

// The 3D robot stage. The model itself needs the assembly exported from Onshape (glTF, cached
// in R2); until then the stage shows the floor, the legend and the part being located.
export function RobotViewer({ statuses, locate }: { statuses: StatusCount[]; locate: { name: string } | null }) {
  const [colors, setColors] = useState<"status" | "plain">("status");
  const [dismissed, setDismissed] = useState(false);

  return (
    <section id="viewer" className="panel flex min-h-80 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Icon name="cube" className="h-4 w-4 text-accent-hover" />
        <h2 className="text-sm font-semibold">3D Assembly Status View</h2>
        <div className="ml-auto">
          <Segmented
            label="Part colours"
            value={colors}
            onChange={setColors}
            options={[
              { value: "status", label: "Status" },
              { value: "plain", label: "Plain" },
            ]}
          />
        </div>
      </div>
      <div className="relative flex-1 overflow-hidden bg-[radial-gradient(ellipse_at_50%_35%,var(--color-surface)_0%,var(--color-raised)_75%)]">
        {/* Grid floor in perspective. */}
        <div
          aria-hidden
          className="absolute inset-x-[-50%] bottom-[-10%] h-[70%] [transform:perspective(500px)_rotateX(62deg)] opacity-60"
          style={{
            backgroundImage:
              "linear-gradient(rgba(0,0,204,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,204,0.14) 1px, transparent 1px)",
            backgroundSize: "36px 36px",
            maskImage: "linear-gradient(to top, black 30%, transparent)",
          }}
        />
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-64 text-sm text-muted">
            The robot model shows here once its main assembly is exported from Onshape.
          </p>
        </div>
        {locate && !dismissed && (
          <div className="absolute top-3 left-3 flex animate-pop items-center gap-2 rounded-md border border-accent/50 bg-surface/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
            <Icon name="locate" className="h-4 w-4 text-accent-hover" />
            <span>
              Locating <span className="font-semibold text-fg">{locate.name}</span>. It will light up when the model is loaded.
            </span>
            <button onClick={() => setDismissed(true)} className="press ml-1 text-muted hover:text-fg" aria-label="Close">
              ✕
            </button>
          </div>
        )}
        {colors === "status" && statuses.length > 0 && (
          <div className="absolute right-3 bottom-3 left-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-2">
            {statuses.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
