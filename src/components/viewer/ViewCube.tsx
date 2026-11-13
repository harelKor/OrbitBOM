"use client";

import { useEffect, useRef, useState } from "react";
import { cubeMatrix, type ViewName } from "./camera";
import type { SectionView } from "./section";
import { DISPLAY_MODES, type DisplayMode } from "./paint";
import { UnitsSwitch } from "./units";
import type { SceneTools } from "./types";

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

const key = "press flex items-center justify-center rounded text-[0.625rem] font-semibold text-fg-2 hover:bg-raised hover:text-fg active:scale-[0.98]";
const box = "rounded-md border border-line bg-surface/95 shadow-sm backdrop-blur";

// The cube menu's views, Onshape's order and keys.
const MENU_VIEWS: { v: ViewName; label: string; key?: string }[] = [
  { v: "front", label: "Front", key: "Shift+1" },
  { v: "back", label: "Back", key: "Shift+2" },
  { v: "left", label: "Left", key: "Shift+3" },
  { v: "right", label: "Right", key: "Shift+4" },
  { v: "top", label: "Top", key: "Shift+5" },
  { v: "bottom", label: "Bottom", key: "Shift+6" },
  { v: "iso", label: "Isometric", key: "Shift+7" },
  { v: "dimetric", label: "Dimetric" },
  { v: "trimetric", label: "Trimetric" },
];

// Onshape's view cube, top right of the 3D view (S1, plan/cad-3d-viewer.md): it turns with the
// camera; a click on a face, edge or corner looks from there; the arrows turn the view 15°, 90° with
// Shift, 5° with Ctrl, like Onshape's. Its
// menu is Onshape's camera and render options (Harel, 2026-11-11): the standard views with
// Dimetric and Trimetric, Zoom to fit, Perspective / Orthographic, and the section (Section view,
// Edit section view, Turn off section view, the same calls as Shift+X). On phones it's 64 px, no
// arrows (a swipe turns the view), and the views sit in a grid so the menu fits. The `?` key opens
// the shortcuts sheet.
const arrowStep = (e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => (e.shiftKey ? 90 : e.ctrlKey || e.metaKey ? 5 : 15);

export function ViewCube({ tools, views }: { tools: SceneTools; views?: NamedViews }) {
  const cube = useRef<HTMLDivElement>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [ortho, setOrtho] = useState(() => tools.projection() === "ortho");
  const [section, setSection] = useState<SectionView | null>(null);
  const [display, setDisplay] = useState<DisplayMode>(() => tools.display());

  useEffect(() => {
    const stop = tools.watch((q) => {
      if (cube.current) cube.current.style.transform = cubeMatrix(q);
    });
    const unSection = tools.onSection(setSection);
    tools.onShortcuts(() => setHelp((h) => !h));
    return () => {
      stop();
      unSection();
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

  const run = (f: () => void) => () => {
    setMenu(false);
    f();
  };
  const project = (o: boolean) => {
    tools.setProjection(o ? "ortho" : "perspective");
    setOrtho(o);
    setMenu(false);
  };
  const item = "press flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fg-2 hover:bg-raised hover:text-fg pointer-coarse:min-h-9";
  const hint = "ml-auto text-[0.625rem] text-subtle pointer-coarse:hidden";
  const line = "my-1 h-px bg-line";

  return (
    <>
      <div
        className="absolute top-3 right-3 z-10 grid size-28 grid-cols-[1fr_var(--cube)_1fr] grid-rows-[1fr_var(--cube)_1fr] place-items-center select-none [--cube:72px] pointer-coarse:size-[calc(var(--cube)+2.5rem)] pointer-coarse:[--cube:64px]"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button className={`${key} col-start-2 row-start-1 h-5 w-8 pointer-coarse:hidden`} title="Turn the view up 15° (Shift: 90°, Ctrl: 5°)" aria-label="Turn the view up" onClick={(e) => tools.orbit(0, arrowStep(e))}>
          ▲
        </button>
        <button className={`${key} col-start-1 row-start-2 h-8 w-5 pointer-coarse:hidden`} title="Turn the view left 15° (Shift: 90°, Ctrl: 5°)" aria-label="Turn the view left" onClick={(e) => tools.orbit(-arrowStep(e), 0)}>
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
                      className={`flex items-center justify-center overflow-visible text-[0.625rem] font-semibold tracking-wide text-fg uppercase ${hot === id ? "bg-accent/25 text-accent-hover" : ""}`}
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
        <button className={`${key} col-start-3 row-start-2 h-8 w-5 pointer-coarse:hidden`} title="Turn the view right 15° (Shift: 90°, Ctrl: 5°)" aria-label="Turn the view right" onClick={(e) => tools.orbit(arrowStep(e), 0)}>
          ▶
        </button>
        <button className={`${key} col-start-2 row-start-3 h-5 w-8 pointer-coarse:hidden`} title="Turn the view down 15° (Shift: 90°, Ctrl: 5°)" aria-label="Turn the view down" onClick={(e) => tools.orbit(0, -arrowStep(e))}>
          ▼
        </button>
        <button
          className={`${key} col-start-3 row-start-3 size-6 pointer-coarse:size-9 pointer-coarse:text-sm ${menu ? "bg-raised text-fg" : ""}`}
          title="View options"
          aria-label="View options"
          aria-expanded={menu}
          onClick={() => {
            // A saved view (S6) may have changed these since the menu was last open.
            setOrtho(tools.projection() === "ortho");
            setDisplay(tools.display());
            setMenu(!menu);
          }}
        >
          ▾
        </button>
        {menu && (
          <div className={`absolute top-full right-0 mt-1 max-h-[min(36rem,75vh)] w-52 animate-pop overflow-y-auto p-1 ${box}`} role="menu" aria-label="Camera and render options">
            <div className="grid grid-cols-1 pointer-coarse:grid-cols-3 pointer-coarse:gap-0.5">
              {MENU_VIEWS.map(({ v, label, key: k }) => (
                <button key={v} className={`${item} pointer-coarse:justify-center pointer-coarse:px-1`} role="menuitem" onClick={run(() => tools.view(v))}>
                  <span className="w-3 pointer-coarse:hidden" />
                  {label}
                  {k && <kbd className={hint}>{k}</kbd>}
                </button>
              ))}
            </div>
            <button className={item} role="menuitem" onClick={run(() => tools.view("fit"))}>
              <span className="w-3" />
              Zoom to fit <kbd className={hint}>F</kbd>
            </button>
            <div className={line} />
            <button className={item} role="menuitemradio" aria-checked={!ortho} onClick={() => project(false)}>
              <span className="w-3 text-accent-hover">{ortho ? "" : "✓"}</span>Perspective
            </button>
            <button className={item} role="menuitemradio" aria-checked={ortho} onClick={() => project(true)}>
              <span className="w-3 text-accent-hover">{ortho ? "✓" : ""}</span>Orthographic
            </button>
            {/* Render modes and units (S9): Onshape's names and order. */}
            <div className={line} />
            <div className="grid grid-cols-1">
              {DISPLAY_MODES.map(({ v, label }) => (
                <button
                  key={v}
                  className={item}
                  role="menuitemradio"
                  aria-checked={display === v}
                  onClick={run(() => {
                    tools.setDisplay(v);
                    setDisplay(v);
                  })}
                >
                  <span className="w-3 shrink-0 text-accent-hover">{display === v ? "✓" : ""}</span>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 px-2 py-1 text-xs text-fg-2">
              <span className="w-3" />
              Units
              <UnitsSwitch className="ml-auto" />
            </div>
            <div className={line} />
            {!section && (
              <button className={item} role="menuitem" onClick={run(() => tools.sectionShow(true))}>
                <span className="w-3" />
                Section view <kbd className={hint}>Shift+X</kbd>
              </button>
            )}
            {section && !section.open && (
              <button className={item} role="menuitem" onClick={run(() => tools.sectionEdit())}>
                <span className="w-3" />
                Edit section view
              </button>
            )}
            {section && (
              <button className={item} role="menuitem" onClick={run(() => tools.sectionShow(false))}>
                <span className="w-3" />
                Turn off section view <kbd className={hint}>Shift+X</kbd>
              </button>
            )}
            {/* Onshape's exploded view (S7). */}
            <button className={item} role="menuitem" onClick={run(() => tools.explodeShow(true))}>
              <span className="w-3" />
              Exploded view
            </button>
            {views && <NamedViewsBlock views={views} close={() => setMenu(false)} item={item} line={line} />}
            <div className={`${line} pointer-coarse:hidden`} />
            <button className={`${item} pointer-coarse:hidden`} role="menuitem" onClick={run(() => setHelp(true))}>
              <span className="w-3" />
              Keyboard shortcuts <kbd className={hint}>?</kbd>
            </button>
          </div>
        )}
      </div>
      {help && <Shortcuts onClose={() => setHelp(false)} />}
    </>
  );
}

// Onshape's Named views (S6, plan/cad-3d-viewer.md), on pages that keep them (the CAD pages: per
// robot in the database, shared by the team): the saved views to pick back, "Save view…" under a
// name, and "Copy view link" (the URL carries the view). Owned by S6; the rest of the menu is R3's
// and S9's.
export type NamedViews = {
  list: { id: string; name: string; by: string | null; mine: boolean }[];
  open: (id: string) => void;
  save: (name: string) => Promise<string | null>; // an error, or null when saved
  remove: (id: string) => void;
  copyLink: () => Promise<boolean>;
};

function NamedViewsBlock({ views, close, item, line }: { views: NamedViews; close: () => void; item: string; line: string }) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <>
      <div className={line} />
      <p className="px-2 pt-1 pb-0.5 text-[0.625rem] font-semibold tracking-wide text-subtle uppercase">Named views</p>
      {views.list.map((v) => (
        <div key={v.id} className="group flex items-center">
          <button
            className={`${item} min-w-0 flex-1`}
            role="menuitem"
            title={v.by ? `Saved by ${v.by}` : undefined}
            onClick={() => {
              close();
              views.open(v.id);
            }}
          >
            <span className="w-3 shrink-0" />
            <span className="truncate">{v.name}</span>
          </button>
          {v.mine && (
            <button
              className="press shrink-0 rounded px-1.5 text-subtle opacity-0 group-hover:opacity-100 hover:text-rose-500 focus:opacity-100 pointer-coarse:min-h-9 pointer-coarse:min-w-9 pointer-coarse:opacity-100"
              aria-label={`Delete ${v.name}`}
              title="Delete this view"
              onClick={() => confirm(`Delete the view "${v.name}"?`) && views.remove(v.id)}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {naming ? (
        <form
          className="flex flex-col gap-1 px-2 py-1"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const err = await views.save(name);
            setBusy(false);
            if (err) return setError(err);
            setNaming(false);
            setName("");
            setError(null);
          }}
        >
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="View name" className="input h-8 w-full text-xs pointer-coarse:h-9" aria-label="View name" />
          {error && <span className="text-[0.6875rem] text-rose-600">{error}</span>}
          <div className="flex gap-1">
            <button className="btn-primary h-7 flex-1 justify-center text-xs active:scale-[0.98] pointer-coarse:h-9" disabled={busy || !name.trim()}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn h-7 justify-center px-2 text-xs pointer-coarse:h-9" onClick={() => setNaming(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className={item} role="menuitem" onClick={() => setNaming(true)}>
          <span className="w-3" />
          Save view…
        </button>
      )}
      <button
        className={item}
        role="menuitem"
        onClick={async () => {
          setCopied(await views.copyLink());
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        <span className="w-3 text-accent-hover">{copied ? "✓" : ""}</span>
        {copied ? "Link copied" : "Copy view link"}
      </button>
    </>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Right drag", "Rotate, about the point you start on"],
  ["Middle drag, Ctrl+right drag", "Move"],
  ["Wheel", "Zoom at the pointer"],
  ["Left drag on empty space", "Box select: → whole parts inside, ← parts it touches (Ctrl: unselect)"],
  ["Click", "Pick (again: unpick); empty space clears"],
  ["F", "Fit"],
  ["Z / Shift+Z", "Zoom out / in"],
  ["Shift+1 … 7", "Front, back, left, right, top, bottom, isometric"],
  ["← → ↑ ↓", "Turn the view 15° (Shift: 90°, Ctrl: 5°)"],
  ["Ctrl+Shift+← → ↑ ↓", "Move the view"],
  ["Y", "Hide the part under the mouse"],
  ["Shift+Y", "Bring a hidden part back"],
  ["Shift+H", "Show or hide the Geometry sketches"],
  ["Shift+X", "Section view on / off"],
  ["N", "View normal to the section, or to a picked face (a round one: along its axis)"],
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
                <kbd className="rounded border border-line bg-raised px-1.5 py-0.5 font-mono text-[0.6875rem] whitespace-nowrap text-fg">{k}</kbd>
              </dt>
              <dd className="self-center text-fg-2">{what}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
