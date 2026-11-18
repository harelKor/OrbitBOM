"use client";

import type { MateView, MotionView } from "./motion";
import type { SceneTools } from "./types";

const tool = "press inline-flex h-8 items-center justify-center rounded-md px-2 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg active:scale-[0.98] pointer-coarse:h-9 pointer-coarse:min-w-9";
const on = "bg-accent/15 text-accent-hover";
const box = "pointer-events-auto animate-pop rounded-md border border-line bg-surface/95 text-xs shadow-md backdrop-blur";

// The bottom of the 3D view while parts are away from their CAD places (S7): Move's bar (Slide /
// Turn, ✓ puts the triad away), Onshape's Exploded view panel (one slider, Reset, ✓), and the
// "Moved (not in CAD)" chip with Reset positions. Only the view changes: nothing is saved.
export function MotionPanel({ view, tools }: { view: MotionView; tools: SceneTools }) {
  const pct = Math.round(view.explode * 100);
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {view.moving && !view.mate && (
        <div className={`${box} flex items-center gap-0.5 p-1`} role="toolbar" aria-label="Move">
          <span className="px-1.5 font-semibold text-fg tabular-nums">Move {view.moving.count > 1 ? `${view.moving.count} parts` : ""}</span>
          <button className={`${tool} ${view.moving.mode === "slide" ? on : ""}`} aria-pressed={view.moving.mode === "slide"} onClick={() => tools.moveMode("slide")} title="Drag an arrow to slide along it">
            Slide
          </button>
          <button className={`${tool} ${view.moving.mode === "turn" ? on : ""}`} aria-pressed={view.moving.mode === "turn"} onClick={() => tools.moveMode("turn")} title="Drag a ring to turn about it">
            Turn
          </button>
          <button className={`${tool} text-base text-accent-hover`} onClick={() => tools.moveDone()} aria-label="Done moving" title="Done (Esc): the parts stay where they are">
            ✓
          </button>
        </div>
      )}
      {view.mate && <MateBar mate={view.mate} tools={tools} />}
      {view.panel ? (
        <div className={`${box} flex w-[min(20rem,100%)] flex-col`} role="dialog" aria-label="Exploded view">
          <div className="flex items-center gap-1 border-b border-line py-1 pr-1 pl-2.5">
            <h2 className="flex-1 text-sm font-semibold text-fg">Exploded view</h2>
            <button className={tool} onClick={() => tools.resetPositions()} disabled={!view.moved} title="Every part back to its CAD place">
              Reset
            </button>
            <button className={`${tool} text-base text-accent-hover`} onClick={() => tools.explodeShow(false)} aria-label="Done" title="Done: close the panel, keep the view">
              ✓
            </button>
          </div>
          <label className="flex items-center gap-2 px-2.5 py-2">
            <span className="sr-only">Spread</span>
            <input
              type="range"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => tools.explode(Number(e.target.value) / 100)}
              onPointerUp={(e) => tools.explode(Number((e.target as HTMLInputElement).value) / 100, true)}
              onKeyUp={(e) => tools.explode(Number((e.target as HTMLInputElement).value) / 100, true)}
              className="h-8 flex-1 accent-accent pointer-coarse:h-10"
            />
            <span className="w-9 text-right text-muted tabular-nums">{pct}%</span>
          </label>
        </div>
      ) : (
        view.moved && (
          <div className={`${box} flex items-center gap-1 py-0.5 pr-0.5 pl-2.5`} role="status">
            <span className="text-muted">Moved (not in CAD)</span>
            <span className="text-subtle">·</span>
            <button className={`${tool} text-accent-hover`} onClick={() => tools.resetPositions()}>
              Reset positions
            </button>
          </div>
        )
      )}
    </div>
  );
}

// Moving along a mate (plan/cad-mates.md): its name, Turn / Slide when it has both, the value from
// the CAD place (° or mm, typed to set it) and Onshape's limits when it has them; ✓ (Esc) puts the
// handle away, the parts stay.
function MateBar({ mate, tools }: { mate: MateView; tools: SceneTools }) {
  const turn = mate.dof === "turn";
  const scale = turn ? 180 / Math.PI : 1000;
  const now = Math.round(mate.value[mate.dof] * scale * 10) / 10;
  const lim = mate.lim?.[mate.dof];
  return (
    <div className={`${box} flex max-w-full flex-wrap items-center gap-0.5 p-1`} role="toolbar" aria-label={`Move along ${mate.name}`}>
      <span className="max-w-40 truncate px-1.5 font-semibold text-fg" title={mate.name}>
        {mate.name}
      </span>
      {mate.dofs.length > 1 &&
        mate.dofs.map((d) => (
          <button key={d} className={`${tool} ${mate.dof === d ? on : ""}`} aria-pressed={mate.dof === d} onClick={() => tools.mateDof(d)}>
            {d === "turn" ? "Turn" : "Slide"}
          </button>
        ))}
      <label className="flex items-center gap-1 px-1">
        <span className="sr-only">{turn ? "Angle" : "Distance"}</span>
        <input
          key={`${mate.name}:${mate.dof}:${now}`}
          type="number"
          step={turn ? 5 : 1}
          defaultValue={now}
          onKeyDown={(e) => e.key === "Enter" && tools.mateValue(mate.dof, Number((e.target as HTMLInputElement).value) / scale)}
          onBlur={(e) => Number(e.target.value) !== now && tools.mateValue(mate.dof, Number(e.target.value) / scale)}
          className="h-8 w-20 rounded-md border border-line bg-surface px-1.5 text-right text-xs text-fg tabular-nums pointer-coarse:h-9"
        />
        <span className="text-muted">{turn ? "°" : "mm"}</span>
      </label>
      {lim && (
        <span className="px-1 text-subtle tabular-nums" title="Onshape's limits">
          {Math.round(lim[0] * scale)}…{Math.round(lim[1] * scale)}
        </span>
      )}
      <button className={tool} onClick={() => tools.mateValue(mate.dof, 0)} disabled={!mate.value[mate.dof]} title="Back to its CAD place">
        Reset
      </button>
      <button className={`${tool} text-base text-accent-hover`} onClick={() => tools.moveDone()} aria-label="Done moving" title="Done (Esc): the parts stay where they are">
        ✓
      </button>
    </div>
  );
}
