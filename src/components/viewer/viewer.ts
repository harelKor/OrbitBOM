// Puts the viewer's modules together for ModelCanvas. Each module is created with what it needs
// (the stage, the meshes array that load.ts fills, callbacks) and returns its tools and a dispose;
// this file only wires them, so a session changing one module rarely needs to touch it.
import type * as THREE from "three";
import { createCamera } from "./camera";
import { loadModel, partTools } from "./load";
import { createMeasureLayer, type MeasureInfo, type MeasureLayer } from "./measureLayer";
import { createLooks, createPaint, type Paint } from "./paint";
import { createMarks, createPicking, createSelection, createTopo, type Picking } from "./picking";
import { createSection } from "./section";
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
  ready: (tools: SceneTools) => void; // the model is drawn
  failed: () => void;
};

export type Viewer = {
  paint: Paint;
  hide: (hidden: Set<number>) => void; // subsystem groups
  select: (key: string | null) => void;
  show: (gone: Gone[]) => void;
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

  const visibility = createVisibility(meshes, {
    changed: () => selection.refresh(),
    hidden: (gone) => host.gone(gone),
    hoverOff: () => picking?.setHover(null),
    fit: (box) => camera.fit(box),
  });
  const camera = createCamera(stage, visibility.shownBox);
  const painter = createPaint(stage, meshes, looks, camera.fit);
  const selection = createSelection(stage, meshes, looks);
  const topo = createTopo(meshes);
  picking = createPicking(stage, meshes, topo, () => measure!, {
    pick: (key) => host.pick(key),
    open: host.open,
    hide: visibility.hideOne,
    showLast: () => {
      const last = visibility.gone().at(-1);
      if (last) visibility.show([last]);
    },
  });
  const marks = createMarks(stage, topo);
  measure = createMeasureLayer(meshes, topo, marks, {
    names: host.names,
    measured: (m) => host.measured(m),
    pick: (key) => host.pick(key),
    hoverOff: () => picking?.setHover(null),
  });
  const section = createSection(stage, [looks.material, looks.cad]);

  const tools: SceneTools = {
    ...camera.tools,
    ...section,
    ...measure.tools,
    ...visibility.tools,
    ...partTools(meshes),
    ...stageTools(stage),
  };

  loadModel(stage, model, looks, { meshes, geometries }, host.progress, () => disposed)
    .then((ok) => {
      if (!ok) return;
      // Frame what's shown: a subsystem page starts with only its own subsystem.
      const hidden = host.hiddenAtLoad();
      for (const { mesh, g } of meshes) mesh.visible = !hidden?.has(g);
      camera.fit(visibility.shownBox());
      host.ready(tools);
    })
    .catch(() => !disposed && host.failed());

  return {
    paint: painter.paint,
    hide: visibility.hideGroups,
    select: selection.select,
    show: visibility.show,
    tools,
    dispose: () => {
      disposed = true;
      camera.dispose();
      picking?.dispose();
      measure?.dispose();
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
