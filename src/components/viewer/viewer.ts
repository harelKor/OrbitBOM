// Puts the viewer's modules together for ModelCanvas. Each module is created with what it needs
// (the stage, the meshes array that load.ts fills, callbacks) and returns its tools and a dispose;
// this file only wires them, so a session changing one module rarely needs to touch it.
import * as THREE from "three";
import { createCamera } from "./camera";
import { createCheckTools } from "./checkScene";
import { createRedOverlap } from "./redOverlap";
import { loadModel, partTools, placementsBox, refitNeeded } from "./load";
import { createMeasureLayer, type MeasureInfo, type MeasureLayer } from "./measureLayer";
import { createLooks, createPaint, type Paint } from "./paint";
import { createMarks, createPicking, createSelection, createTopo, type MenuTarget, type Picking } from "./picking";
import { createMotion } from "./motion";
import { createPins } from "./pins";
import { createSection } from "./section";
import { loadSketches, sketchKeys } from "./sketches";
import { removedBy } from "./sectionMath";
import { createStage, stageTools } from "./stage";
import type { Gone, PartMesh, SceneTools, ViewerModel } from "./types";
import { createVisibility } from "./visibility";

export type ViewerHost = {
  hiddenAtLoad: () => Set<number> | undefined; // subsystem groups not drawn when the model arrives
  names: () => Map<string, string> | undefined;
  pick: (key: string | null) => void;
  open: () => ((key: string) => void) | undefined;
  measured: (m: MeasureInfo) => void;
  gone: (gone: Gone[]) => void;
  progress: (done: number, total: number) => void;
  ready: (tools: SceneTools) => void; // the first parts are drawn (the rest follow as they arrive)
  located?: (found: boolean) => void; // Locate's answer changed once the later parts arrived
  failed: () => void;
  // Some mesh files didn't load (the rest did): how many, and a Retry for just those. 0 once a retry got them all.
  partial?: (failed: number, retry: () => void) => void;
  menu: (m: MenuTarget) => void; // right-click / long press: the context menu
  isolated: (keys: string[] | null) => void;
  hover?: (key: string | null) => void; // the part under the mouse (mouse only)
  sketches?: (shown: boolean) => void; // Geometry sketches turned on or off (Shift+H)
};

export type Viewer = {
  paint: Paint;
  hide: (hidden: Set<number>) => void; // subsystem groups
  select: (keys: string | readonly string[] | null) => void;
  show: (gone: Gone[]) => void;
  hideCopy: (g: Gone) => void;
  tools: SceneTools;
  dispose: () => void;
};

export function createViewer(el: HTMLElement, model: ViewerModel, host: ViewerHost): Viewer {
  let disposed = false;
  const stage = createStage(el);
  const meshes: PartMesh[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const looks = createLooks();

  // Late-bound: these modules call each other back.
  let picking: Picking | null = null;
  let measure: MeasureLayer | null = null;

  const visibility = createVisibility(meshes, stage.root, looks, {
    changed: () => selection.refresh(),
    hidden: (gone) => host.gone(gone),
    isolated: (keys) => host.isolated(keys),
    sketches: (shown) => host.sketches?.(shown),
    hoverOff: () => picking?.setHover(null),
    fit: (box) => camera.fit(box),
  });
  const camera = createCamera(stage, visibility.shownBox, meshes);
  // Repainting a batch that arrived late doesn't frame the located part again (quietFit).
  let quietFit = false;
  const painter = createPaint(stage, meshes, looks, (box, r) => !quietFit && camera.fit(box, r));
  const selection = createSelection(stage, meshes, looks);
  const topo = createTopo(meshes);
  picking = createPicking(stage, meshes, topo, () => measure!, {
    pick: (key) => host.pick(key),
    open: host.open,
    hide: visibility.hideOne,
    hiddenAt: visibility.hiddenAt,
    anyHidden: () => visibility.gone().length > 0,
    showHidden: (g) => visibility.show([g]),
    names: host.names,
    hovered: (key) => host.hover?.(key),
    sectionTap: (e) => section.tap(e),
    kept: () => {
      const cuts = section.tools.sectionNow()?.planes;
      if (!cuts?.length) return null;
      const toModel = stage.root.matrixWorld.clone().invert();
      const q = new THREE.Vector3();
      return (p) => !cuts.some((c) => removedBy(c, q.copy(p).applyMatrix4(toModel)));
    },
    menu: (at) => {
      // On a picked part, the menu acts on every picked part (Onshape acts on the selection).
      const picked = measure?.parts() ?? [];
      const keys = !at.under?.key ? [] : picked.includes(at.under.key) ? picked : [at.under.key];
      const copies = at.under ? meshes.reduce((n, { keys: ks }) => n + ks.filter((k) => k === at.under!.key).length, 0) : 0;
      const hiddenCopies = at.under ? visibility.gone().filter((g) => g.key === at.under!.key).length : 0;
      host.menu({ ...at, keys, copies, hidden: visibility.gone().length, hiddenCopies, isolated: visibility.isolated() });
    },
  });
  const marks = createMarks(stage, meshes, topo);
  measure = createMeasureLayer(meshes, topo, marks, {
    names: host.names,
    measured: (m) => {
      section.picked(m.parts, measure?.newest() ?? null);
      host.measured(m);
    },
    pick: (key) => host.pick(key),
    hoverOff: () => picking?.setHover(null),
  });
  const section = createSection(stage, meshes, topo, (dir) => camera.tools.look(dir));
  const motion = createMotion(stage, meshes, camera.controls, {
    place: visibility.place,
    setPlace: visibility.setPlace,
    shown: (m, i) => meshes[m].mesh.visible && !visibility.gone().some((g) => g.m === m && g.i === i),
    moved: () => selection.refresh(),
    // The section's outlines are worked out from where the parts were: once more where they are.
    settled: () => {
      const s = section.tools.sectionNow();
      if (s) section.tools.section(s);
    },
  });
  const red = createRedOverlap(stage); // a Design check overlap's Show
  const pins = createPins(stage, meshes, topo, () => measure?.newest() ?? null); // comment pins (S6)
  let loadedAll: () => void = () => {};
  const allIn = new Promise<void>((r) => (loadedAll = r));

  const tools: SceneTools = {
    ...camera.tools,
    // A page putting the camera somewhere (a saved view) counts as moving it: the end of loading
    // doesn't frame the model again over it.
    setPose: (pose, animate) => {
      touched = true;
      camera.tools.setPose(pose, animate);
    },
    ...section.tools,
    ...measure.tools,
    ...visibility.tools,
    ...partTools(meshes),
    ...stageTools(stage),
    ...motion.tools,
    ...pins.tools,
    ...createCheckTools(meshes, visibility.place),
    ...red.tools,
    whenLoaded: () => allIn, // every part file is in (a saved view's hidden parts can be found)
    // Onshape's render modes (S9): paint again, then put Make transparent's parts back.
    display: painter.display,
    setDisplay: (m) => {
      painter.setDisplay(m);
      visibility.repaint();
      stage.render();
    },
    statusOpacity: (o) => {
      painter.statusOpacity(o);
      visibility.repaint();
      stage.render();
    },
    fadeGroups: (m) => {
      painter.fade(m);
      stage.render();
    },
  };

  // Drawn as the files arrive: the first Fit comes from where the parts sit (a subsystem page
  // frames only its own subsystem), before any mesh is in; each later batch gets the page's
  // subsystems, colours and selection. The view is framed again at the end only if the guess was
  // well off and nobody has moved the camera yet.
  let groupsHidden = host.hiddenAtLoad() ?? new Set<number>();
  let painted: Parameters<Paint> | null = null;
  let located = false;
  let loading = true;
  let shown = false;
  let touched = false;
  camera.controls.addEventListener("start", () => (touched = true));
  stage.root.updateMatrixWorld();
  let framed = placementsBox(model.placements, groupsHidden)?.applyMatrix4(stage.root.matrixWorld) ?? null;
  if (framed) camera.fit(framed);
  const paint: Paint = (colors, mode, locateKey) => {
    painted = [colors, mode, locateKey];
    located = painter.paint(colors, mode, locateKey);
    visibility.repaint();
    return located || (loading && !!locateKey); // the located part may still be on its way
  };
  const hide = (hidden: Set<number>) => {
    groupsHidden = hidden;
    visibility.hideGroups(hidden);
  };
  const firstDraw = () => {
    shown = true;
    if (!framed) camera.fit((framed = visibility.shownBox()));
    host.ready(tools);
  };
  const loaders: { dispose: () => void }[] = [];
  const load = (only?: number[]) => {
    // A retry asks again only for the files that failed; the others are already drawn.
    const part = only ? { ...model, studios: model.studios.map((u, i) => (only.includes(i) ? u : null)) } : model;
    const loader = loadModel(stage, part, looks, { meshes, geometries }, { progress: host.progress, added }, () => disposed);
    loaders.push(loader);
    return loader.done;
  };
  const added = () =>
    stage.batch(() => {
      visibility.hideGroups(groupsHidden); // also redraws the selection
      if (painted) {
        const was = located;
        quietFit = was;
        located = painter.paint(...painted);
        visibility.repaint();
        quietFit = false;
        if (located && !was) host.located?.(true);
      }
      if (!shown) firstDraw();
      stage.render();
    });
  const first = load();
  // Geometry sketches (sketches.ts): small files, drawn when they arrive; off at first on the
  // Final model, where Shift+H shows them (Harel, 2026-11-12).
  if (model.sketchesHidden) visibility.tools.showSketches(false);
  const sketchLoad = loadSketches(
    stage,
    model,
    { meshes, geometries },
    {
      added: () =>
        stage.batch(() => {
          visibility.hideGroups(groupsHidden);
          if (!shown) firstDraw();
          stage.render();
        }),
    },
    () => disposed,
  );
  const offSketchKeys = sketchKeys(el, () => {
    if (!visibility.tools.hasSketches()) return false;
    visibility.tools.showSketches(!visibility.tools.sketchesShown());
    return true;
  });
  // Settles once every file came in or failed, so the Design check and saved views never wait
  // forever on one bad download (audit 2026-11-14).
  const settled = (failed: number[]) => {
    if (disposed) return;
    if (failed.length) host.partial?.(failed.length, () => void load(failed).then((r) => !r.cancelled && settled(r.failed)));
    else host.partial?.(0, () => {});
  };
  Promise.all([first, sketchLoad.done.catch(() => true)])
    .then(([{ cancelled, failed }]) => {
      if (cancelled || disposed) return;
      loading = false;
      loadedAll();
      // Nothing at all came in: the whole model failed.
      if (failed.length && failed.length === model.studios.filter(Boolean).length) return host.failed();
      if (!shown) firstDraw();
      else if (!touched && framed && refitNeeded(framed, visibility.shownBox())) camera.fit(visibility.shownBox());
      if (painted?.[2] && !located) host.located?.(false);
      settled(failed);
    })
    .catch(() => {
      if (disposed) return;
      loadedAll();
      host.failed();
    });

  // Phones draw at a lower pixel ratio while the view moves, sharp again when it stops.
  const sharp = stage.renderer.getPixelRatio();
  if (sharp > 1 && window.matchMedia("(pointer: coarse)").matches) {
    // …and without the silhouettes (S9), one more draw of every part.
    camera.controls.addEventListener("start", () => {
      stage.renderer.setPixelRatio(1);
      painter.outlines(false);
    });
    camera.controls.addEventListener("end", () => {
      painter.outlines(true);
      stage.renderer.setPixelRatio(sharp);
      stage.render();
    });
  }

  return {
    paint,
    hide,
    select: selection.select,
    show: visibility.show,
    hideCopy: visibility.hideOne,
    tools,
    dispose: () => {
      disposed = true;
      loaders.forEach((l) => l.dispose());
      sketchLoad.dispose();
      offSketchKeys();
      camera.dispose();
      picking?.dispose();
      visibility.dispose();
      measure?.dispose();
      section.dispose();
      motion.dispose();
      pins.dispose();
      red.dispose();
      geometries.forEach((g) => g.dispose());
      marks.dispose();
      topo.dispose();
      meshes.forEach(({ mesh }) => mesh.dispose());
      painter.dispose();
      looks.dispose();
      stage.dispose();
    },
  };
}
