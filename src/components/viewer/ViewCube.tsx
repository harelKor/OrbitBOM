"use client";

import { useEffect, useRef, useState } from "react";
import { cubeMatrix, type CameraTools } from "./camera";

type V = [number, number, number];
// The cube's faces in the scene's frame: outward normal, the face's right and up on screen, and
// where CSS puts it. Labels are Onshape's (its front is the model's -Y, the scene's +Z).
const FACES: { label: string; n: V; r: V; u: V; place: string }[] = [
  { label: "Front", n: [0, 0, 1], r: [1, 0, 0], u: [0, 1, 0], place: "" },
  { label: "Back", n: [0, 0, -1], r: [-1, 0, 0], u: [0, 1, 0], place: "rotateY(180deg)" },
  { label: "Right", n: [1, 0, 0], r: [0, 0, -1], u: [0, 1, 0], place: "rotateY(90deg)" },
  { label: "Left", n: [-1, 0, 0], r: [0, 0, 1], u: [0, 1, 0], place: "rotateY(-90deg)" },
  { label: "Top", n: [0, 1, 0], r: [1, 0, 0], u: [0, 0, -1], place: "rotateX(90deg)" },
  { label: "Bottom", n: [0, -1, 0], r: [1, 0, 0], u: [0, 0, 1], place: "rotateX(-90deg)" },
];
// Each face is a 3×3 grid: the middle looks at the face, the sides at an edge, the corners at a
// corner (the direction is the sum of the faces' normals).
const CELLS = [1, 0, -1].flatMap((b) => [-1, 0, 1].map((a) => [a, b] as const));
const dirOf = (f: (typeof FACES)[number], a: number, b: number): V => [0, 1, 2].map((k) => f.n[k] + a * f.r[k] + b * f.u[k]) as V;

const key = "press flex items-center justify-center rounded text-[10px] font-semibold text-fg-2 hover:bg-raised hover:text-fg active:scale-[0.98]";
const box = "rounded-md border border-line bg-surface/95 shadow-sm backdrop-blur";

// Onshape's view cube, top right of the 3D view (S1, plan/cad-3d-viewer.md): it turns with the
// camera; a click on a face, edge or corner looks from there; the arrows turn the view 90°; its menu
// switches orthographic / perspective and has Iso, Dimetric and Fit. On phones it's 64 px, no
// arrows (a swipe turns the view). The `?` key opens the shortcuts sheet.
export function ViewCube({ tools }: { tools: CameraTools }) {
  const cube = useRef<HTMLDivElement>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [ortho, setOrtho] = useState(() => tools.projection() === "ortho");

  useEffect(() => {
    const stop = tools.watch((q) => {
      if (cube.current) cube.current.style.transform = cubeMatrix(q);
    });
    tools.onShortcuts(() => setHelp((h) => !h));
    return () => {
      stop();
      tools.onShortcuts(null);
    };
  }, [tools]);

  // The menu and the sheet close on a click elsewhere or Esc.
  useEffect(() => {
    if (!menu && !help) return;
    const close = () => {
      setMenu(false);
      setHelp(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, help]);

  const project = (o: boolean) => {
    tools.setProjection(o ? "ortho" : "perspective");
    setOrtho(o);
    setMenu(false);
  };
  const item = "press flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fg-2 hover:bg-raised hover:text-fg pointer-coarse:min-h-9";

  return (
    <>
      <div
        className="absolute top-3 right-3 z-10 grid size-28 grid-cols-[1fr_var(--cube)_1fr] grid-rows-[1fr_var(--cube)_1fr] place-items-center select-none [--cube:72px] pointer-coarse:size-[calc(var(--cube)+2.5rem)] pointer-coarse:[--cube:64px]"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button className={`${key} col-start-2 row-start-1 h-5 w-8 pointer-coarse:hidden`} title="Turn the view up 90°" aria-label="Turn the view up" onClick={() => tools.orbit(0, 90)}>
          ▲
        </button>
        <button className={`${key} col-start-1 row-start-2 h-8 w-5 pointer-coarse:hidden`} title="Turn the view left 90°" aria-label="Turn the view left" onClick={() => tools.orbit(-90, 0)}>
          ◀
        </button>
        <div className="col-start-2 row-start-2 size-(--cube)" onPointerLeave={() => setHot(null)}>
          <div ref={cube} className="relative size-full" style={{ transformStyle: "preserve-3d" }}>
            {FACES.map((f) => (
              <div
                key={f.label}
                className="absolute inset-0 grid grid-cols-[22%_1fr_22%] grid-rows-[22%_1fr_22%] overflow-hidden rounded-[3px] border border-line-strong bg-raised/95 shadow-[inset_0_0_6px_rgb(0_0_0/0.08)] [backface-visibility:hidden]"
                style={{ transform: `${f.place} translateZ(calc(var(--cube) / 2))` }}
              >
                {CELLS.map(([a, b]) => {
                  const dir = dirOf(f, a, b);
                  const id = dir.join(",");
                  return (
                    <button
                      key={`${a},${b}`}
                      aria-label={a || b ? undefined : `${f.label} view`}
                      tabIndex={a || b ? -1 : 0}
                      className={`flex items-center justify-center overflow-visible text-[10px] font-semibold tracking-wide text-fg uppercase ${hot === id ? "bg-accent/25 text-accent-hover" : ""}`}
                      onPointerEnter={(e) => e.pointerType === "mouse" && setHot(id)}
                      onClick={() => tools.look(dir)}
                    >
                      {!a && !b && f.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <button className={`${key} col-start-3 row-start-2 h-8 w-5 pointer-coarse:hidden`} title="Turn the view right 90°" aria-label="Turn the view right" onClick={() => tools.orbit(90, 0)}>
          ▶
        </button>
        <button className={`${key} col-start-2 row-start-3 h-5 w-8 pointer-coarse:hidden`} title="Turn the view down 90°" aria-label="Turn the view down" onClick={() => tools.orbit(0, -90)}>
          ▼
        </button>
        <button
          className={`${key} col-start-3 row-start-3 size-6 pointer-coarse:size-9 pointer-coarse:text-sm ${menu ? "bg-raised text-fg" : ""}`}
          title="View options"
          aria-label="View options"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          ▾
        </button>
        {menu && (
          <div className={`absolute top-full right-0 mt-1 w-44 animate-pop p-1 ${box}`} role="menu">
            <button className={item} role="menuitemradio" aria-checked={ortho} onClick={() => project(true)}>
              <span className="w-3 text-accent-hover">{ortho ? "✓" : ""}</span>Orthographic
            </button>
            <button className={item} role="menuitemradio" aria-checked={!ortho} onClick={() => project(false)}>
              <span className="w-3 text-accent-hover">{ortho ? "" : "✓"}</span>Perspective
            </button>
            <div className="my-1 h-px bg-line" />
            {(
              [
                ["iso", "Isometric"],
                ["dimetric", "Dimetric"],
                ["fit", "Fit"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                className={item}
                role="menuitem"
                onClick={() => {
                  tools.view(v);
                  setMenu(false);
                }}
              >
                <span className="w-3" />
                {label}
              </button>
            ))}
            <div className="my-1 h-px bg-line pointer-coarse:hidden" />
            <button
              className={`${item} pointer-coarse:hidden`}
              role="menuitem"
              onClick={() => {
                setMenu(false);
                setHelp(true);
              }}
            >
              <span className="w-3" />
              Keyboard shortcuts <kbd className="ml-auto text-subtle">?</kbd>
            </button>
          </div>
        )}
      </div>
      {help && <Shortcuts onClose={() => setHelp(false)} />}
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Right or left drag", "Rotate, about the point you start on"],
  ["Middle drag", "Move"],
  ["Wheel", "Zoom at the pointer"],
  ["F", "Fit"],
  ["Shift+1 … 7", "Front, back, left, right, top, bottom, isometric"],
  ["← → ↑ ↓", "Turn the view 15° (with Shift: 90°)"],
  ["Y", "Hide the part under the mouse"],
  ["Shift+Y", "Bring a hidden part back"],
  ["Space", "Drop the last pick"],
  ["Esc", "Clear the picks"],
  ["?", "This list"],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/10 p-4" onClick={(e) => (e.stopPropagation(), onClose())} onPointerDown={(e) => e.stopPropagation()}>
      <div className={`w-full max-w-sm animate-pop p-3 ${box}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">3D view shortcuts</h2>
          <button className="press rounded px-2 py-1 text-xs text-muted hover:bg-raised hover:text-fg" onClick={onClose}>
            Close
          </button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          {SHORTCUTS.map(([k, what]) => (
            <div key={k} className="contents">
              <dt>
                <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-fg">{k}</kbd>
              </dt>
              <dd className="self-center text-fg-2">{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
