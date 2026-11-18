"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ContextMenu, type PageMenu } from "@/components/viewer/ContextMenu";
import type { MeasureInfo } from "@/components/viewer/measureLayer";
import type { Paint } from "@/components/viewer/paint";
import type { MotionView } from "@/components/viewer/motion";
import { MotionPanel } from "@/components/viewer/MotionPanel";
import type { MenuTarget } from "@/components/viewer/picking";
import type { SectionView } from "@/components/viewer/section";
import { SectionDialog } from "@/components/viewer/SectionDialog";
import type { Gone, HiddenParts, SceneTools, ViewerMode, ViewerModel } from "@/components/viewer/types";
import { ViewCube, type NamedViews } from "@/components/viewer/ViewCube";
import { GhostSlider } from "@/components/viewer/GhostSlider";
import { createViewer } from "@/components/viewer/viewer";

// The viewer itself lives in src/components/viewer/ (plan/cad-3d-viewer.md §3); this is its React
// shell: props, effects and the overlays. The pages import the viewer's types from here.
export type { ViewerModel, ViewerMode, HiddenParts, SceneTools, MeasureInfo };
export type { ViewName } from "@/components/viewer/camera";
export type { Axis, Section } from "@/components/viewer/section";
export type { MeasureFilter } from "@/components/viewer/picking";
export type { MenuItem, PageMenu } from "@/components/viewer/ContextMenu";
export type { NamedViews };

// The three.js stage: one instanced mesh per part shape, coloured by status (or CAD: Onshape's
// own appearance, see-through parts included, lit by a studio environment like Onshape's). While
// locating, the robot turns see-through and the located part is drawn solid in bright green.
// Like Onshape: right drag rotates, middle drag moves, the wheel zooms (left drag also rotates,
// for touchpads). With a mouse, the part under it is washed in light blue; Y hides it, Shift+Y
// brings back the hidden part under the mouse (Harel, 2026-11-10), and a compact list on the left
// shows the hidden parts, a click there brings one back (Harel, 2026-11-07). Right-click (or a
// long press) opens a menu on the part.
export function ModelCanvas({
  model,
  colors,
  mode,
  locateKey,
  onLocated,
  hidden,
  selectedKey,
  onPick,
  onOpen,
  onBox,
  names,
  panelLeft,
  onTools,
  onMeasure,
  onHidden,
  menu,
  onIsolated,
  onHover,
  cube: cubeProp,
  views,
  statusOpacity = null,
}: {
  model: ViewerModel;
  colors: Map<string, string>; // part key → status colour
  mode: ViewerMode;
  locateKey: string | null;
  onLocated: (found: boolean) => void;
  hidden?: Set<number>; // subsystem groups not drawn
  selectedKey?: string | readonly string[] | null; // a part picked with a click (or Bulk edit's parts): drawn in bright green
  onPick?: (key: string | null) => void; // a click on a part (its key) or on empty space (null)
  onOpen?: (key: string) => void; // a double-click on a part
  // Box select while no faces are being picked (a BOM page's Bulk edit): the parts' keys the box
  // took (drop: Ctrl held, take them off). Without it a box needs face picking on.
  onBox?: (keys: string[], drop: boolean) => void;
  names?: Map<string, string>; // part key -> its name, for the hidden parts list
  panelLeft?: number; // px from the left for the hidden parts list, past the viewer's own panels
  onTools?: (tools: SceneTools | null) => void; // the review tools, once the model is loaded
  onMeasure?: (m: MeasureInfo) => void;
  onHidden?: (h: HiddenParts | null) => void; // the page shows the hidden parts list itself
  menu?: PageMenu; // the page's own context menu items for the parts it's on
  onIsolated?: (keys: string[] | null) => void; // Isolate turned on / changed / ended (any way)
  onHover?: (key: string | null) => void; // the part under the mouse (mouse only), or null
  // The view cube and its menu (with the section): by default on pages with the tools; part
  // windows and the robot page ask for it (Harel, 2026-11-11). False: small views, the slides.
  cube?: boolean;
  views?: NamedViews; // Onshape's Named views in the cube's menu (S6: the CAD pages)
  statusOpacity?: number | null; // "status" mode drawn see-through at about this opacity (the BOM pages' Status view)
}) {
  const withCube = cubeProp ?? !!onTools;
  const host = useRef<HTMLDivElement>(null);
  // Recolours the parts and frames the located one; true when it is in the model.
  const scene = useRef<{
    paint: Paint;
    hide: (hidden: Set<number>) => void;
    select: (keys: string | readonly string[] | null) => void;
    show: (gone: Gone[]) => void;
    hideCopy: (g: Gone) => void;
    tools: SceneTools;
  } | null>(null);
  const [menuAt, setMenuAt] = useState<{ at: MenuTarget; tools: SceneTools; hideCopy: (g: Gone) => void } | null>(null);
  const closeMenu = useCallback(() => setMenuAt(null), []);
  const isolatedRef = useRef(onIsolated);
  useEffect(() => {
    isolatedRef.current = onIsolated;
  }, [onIsolated]);
  const hoverRef = useRef(onHover);
  useEffect(() => {
    hoverRef.current = onHover;
  }, [onHover]);
  const toolsRef = useRef(onTools);
  useEffect(() => {
    toolsRef.current = onTools;
  }, [onTools]);
  const namesRef = useRef(names);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);
  const measureRef = useRef(onMeasure);
  useEffect(() => {
    measureRef.current = onMeasure;
  }, [onMeasure]);
  const [gone, setGone] = useState<Gone[]>([]);
  const pick = useRef(onPick);
  const openPart = useRef(onOpen);
  const boxParts = useRef(onBox);
  useEffect(() => {
    pick.current = onPick;
    openPart.current = onOpen;
    boxParts.current = onBox;
  }, [onPick, onOpen, onBox]);
  // Parts draw as their files arrive: `loaded` once the first are in, `progress` until the last.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>({ done: 0, total: model.studios.length });
  const [loaded, setLoaded] = useState(false);
  const locatedRef = useRef(onLocated);
  useEffect(() => {
    locatedRef.current = onLocated;
  }, [onLocated]);
  const [error, setError] = useState<string | null>(null);
  // Some files didn't load: "N failed · Retry" over the view, the rest of the model shown.
  const [partial, setPartial] = useState<{ failed: number; retry: () => void } | null>(null);
  const [cube, setCube] = useState<SceneTools | null>(null); // the view cube's tools, once loaded
  const [isolatedKeys, setIsolatedKeys] = useState<string[] | null>(null); // for the ghost slider
  // The section lives in the viewer (its 3D handle, Shift+X and the menus change it); its panel
  // shows here, on every view with the cube, so the cube menu's Section view works everywhere.
  const [section, setSection] = useState<SectionView | null>(null);
  useEffect(() => (cube && withCube ? cube.onSection(setSection) : undefined), [cube, withCube]);
  // Explode and Move (S7): their panel and the "Moved (not in CAD)" chip.
  const [motion, setMotion] = useState<MotionView | null>(null);
  useEffect(() => (cube ? cube.onMotion(setMotion) : undefined), [cube]);
  const hiddenAtLoad = useRef(hidden);
  useEffect(() => {
    hiddenAtLoad.current = hidden;
  }, [hidden]);

  // Scene, camera, controls, and the model's geometry.
  useEffect(() => {
    const viewer = createViewer(host.current!, model, {
      hiddenAtLoad: () => hiddenAtLoad.current,
      names: () => namesRef.current,
      pick: (key) => pick.current?.(key),
      open: () => openPart.current,
      boxed: () => boxParts.current,
      measured: (m) => measureRef.current?.(m),
      gone: setGone,
      progress: (done, total) => setProgress(done < total ? { done, total } : null),
      ready: (tools) => {
        setLoaded(true);
        setCube(tools);
        toolsRef.current?.(tools);
      },
      located: (found) => locatedRef.current(found),
      failed: () => setError("The 3D model couldn't load. Try reloading the page."),
      partial: (failed, retry) => setPartial(failed ? { failed, retry } : null),
      menu: (at) => setMenuAt({ at, tools: viewer.tools, hideCopy: viewer.hideCopy }),
      isolated: (keys) => {
        setIsolatedKeys(keys);
        isolatedRef.current?.(keys);
      },
      hover: (key) => hoverRef.current?.(key),
    });
    scene.current = viewer;
    return () => {
      viewer.dispose();
      scene.current = null;
      toolsRef.current?.(null);
      setGone([]);
      setMenuAt(null);
      setLoaded(false);
      setCube(null);
      setSection(null);
      setMotion(null);
    };
  }, [model]);

  // The hidden parts, handed to a page that lists them itself; null when none are hidden.
  const hiddenRef = useRef(onHidden);
  useEffect(() => {
    hiddenRef.current = onHidden;
  }, [onHidden]);
  useEffect(() => {
    hiddenRef.current?.(
      gone.length
        ? {
            items: gone.map((g) => ({ id: `${g.m}:${g.i}`, name: names?.get(g.key) ?? "Part" })).reverse(),
            show: (id) => scene.current?.show(id ? gone.filter((g) => `${g.m}:${g.i}` === id) : gone),
          }
        : null,
    );
  }, [gone, names]);

  // Colours and Locate.
  useEffect(() => {
    if (loaded) onLocated(scene.current?.paint(colors, mode, locateKey) ?? false);
  }, [loaded, colors, mode, locateKey, onLocated]);
  useEffect(() => {
    if (loaded) scene.current?.tools.statusOpacity(statusOpacity);
  }, [loaded, statusOpacity]);
  const selectedKeyRef = useRef(selectedKey);
  useEffect(() => {
    if (!loaded) return;
    if (hidden) scene.current?.hide(hidden);
    scene.current?.select(selectedKeyRef.current ?? null);
  }, [loaded, hidden]);
  useEffect(() => {
    selectedKeyRef.current = selectedKey;
    if (loaded) scene.current?.select(selectedKey ?? null);
  }, [loaded, selectedKey]);

  return (
    <div ref={host} className="absolute inset-0">
      {!loaded && !error && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">Loading the robot…</div>}
      {progress && !error && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-line/40" role="progressbar" aria-label="Loading the robot" aria-valuenow={Math.round((progress.done / Math.max(1, progress.total)) * 100)}>
          <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
        </div>
      )}
      {menuAt && !progress && <ContextMenu {...menuAt} names={names} page={menu} onClose={closeMenu} />}
      {cube && withCube && <ViewCube tools={cube} views={views} />}
      {cube && isolatedKeys && <GhostSlider key={isolatedKeys.join()} tools={cube} />}
      {cube && withCube && section?.open && (
        // Past the page's own left panels (panelLeft); on narrow screens under the view cube, which
        // it would otherwise cover (R1's report).
        <div className="pointer-events-none absolute inset-0 z-30 max-sm:top-29 [&>*]:pointer-events-auto" style={panelLeft !== undefined ? { left: panelLeft } : undefined}>
          <SectionDialog section={section} tools={cube} />
        </div>
      )}
      {cube && motion && (motion.panel || motion.moving || motion.moved) && <MotionPanel view={motion} tools={cube} />}
      {error && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">{error}</div>}
      {partial && !error && !progress && (
        <div className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface/95 px-3 py-1 text-xs shadow-sm backdrop-blur" role="status">
          <span className="text-fg-2 tabular-nums">
            {partial.failed} {partial.failed === 1 ? "file" : "files"} failed
          </span>
          <span className="text-faint">·</span>
          <button
            type="button"
            onClick={() => {
              const { retry } = partial;
              setPartial(null);
              retry();
            }}
            className="press font-semibold text-accent hover:underline active:scale-[0.98] pointer-coarse:min-h-9"
          >
            Retry
          </button>
        </div>
      )}
      {gone.length > 0 && !onHidden && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={panelLeft !== undefined ? { left: panelLeft } : undefined}
          className="absolute top-3 left-3 z-10 flex max-h-[calc(100%-4rem)] w-44 animate-pop cursor-auto flex-col overflow-hidden rounded-md border border-line bg-surface/95 text-xs shadow-sm backdrop-blur"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-1.5 font-semibold text-muted">
            <span className="tabular-nums">Hidden · {gone.length}</span>
            <button onClick={() => scene.current?.show(gone)} className="press font-medium text-accent-hover hover:underline">
              Show all
            </button>
          </div>
          <ul className="flex-1 overflow-y-auto p-1">
            {gone
              .slice()
              .reverse()
              .map((g) => (
                <li key={`${g.m}:${g.i}`}>
                  <button
                    onClick={() => scene.current?.show([g])}
                    title="Show it again"
                    className="press block w-full truncate rounded px-2 py-1.5 text-left text-fg-2 hover:bg-raised hover:text-fg pointer-coarse:min-h-9"
                  >
                    {names?.get(g.key) ?? "Part"}
                  </button>
                </li>
              ))}
          </ul>
          <p className="border-t border-line px-2.5 py-1 text-[0.625rem] text-subtle pointer-coarse:hidden">Y hides · Shift+Y brings back the one under the mouse</p>
        </div>
      )}
    </div>
  );
}
