// Picking: the ray from the pointer, the part under the mouse (washed in light blue), the selected
// part (bright green), faces / edges / corners under the pointer, the marks drawn on them, and the
// pointer and Y keys on the canvas.
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { topology, type Topology, type V3 } from "@/lib/model/topology";
import type { MeasureLayer } from "./measureLayer";
import { HOVER, type Looks } from "./paint";
import type { Stage } from "./stage";
import type { Gone, PartMesh } from "./types";

// A face, edge or corner (`n`) of copy `i` of mesh `m`.
export type Pick = { m: number; i: number; kind: "face" | "edge" | "point"; n: number };
export const samePick = (a: Pick, b: Pick) => a.m === b.m && a.i === b.i && a.kind === b.kind && a.n === b.n;

// Measure chosen faces, edges and corners like Onshape's selection filter: Any takes a corner, else
// an edge, else the face under the pointer (Harel, 2026-11-09).
export type MeasureFilter = "any" | "face" | "edge" | "point";

// Each part shape's faces and edges, worked out once, the first time the pointer meets it.
export type Topo = {
  topoOf: (m: number) => Topology;
  placeOf: (m: number, i: number) => THREE.Matrix4; // copy i's placement (a new matrix)
  faceGeom: (m: number, f: number) => THREE.BufferGeometry; // a face's own triangles, kept for drawing it lit
  dispose: () => void;
};

export function createTopo(meshes: PartMesh[]): Topo {
  const topo = new Map<THREE.BufferGeometry, Topology>();
  const topoOf = (m: number) => {
    const g = meshes[m].mesh.geometry;
    let t = topo.get(g);
    if (!t) {
      t = topology(g.getAttribute("position").array, g.index!.array);
      topo.set(g, t);
    }
    return t;
  };
  const placeOf = (m: number, i: number) => {
    const at = new THREE.Matrix4();
    meshes[m].mesh.getMatrixAt(i, at);
    return at;
  };
  const faceGeoms = new Map<string, THREE.BufferGeometry>();
  const faceGeom = (m: number, f: number) => {
    const g = meshes[m].mesh.geometry;
    const id = `${g.uuid}:${f}`;
    let fg = faceGeoms.get(id);
    if (!fg) {
      const idx = g.index!.array;
      const tris = topoOf(m).faces[f].tris;
      const sub = new Uint32Array(tris.length * 3);
      tris.forEach((t, k) => sub.set([idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]], k * 3));
      fg = new THREE.BufferGeometry();
      fg.setAttribute("position", g.getAttribute("position"));
      fg.setIndex(new THREE.BufferAttribute(sub, 1));
      faceGeoms.set(id, fg);
    }
    return fg;
  };
  return { topoOf, placeOf, faceGeom, dispose: () => faceGeoms.forEach((g) => g.dispose()) };
}

// The picked faces, edges and corners (hover blue, picked orange) and the measured gap.
export type Marks = { draw: (hover: Pick | null, chosen: Pick[], line: [V3, V3] | null) => void; dispose: () => void };

export function createMarks(stage: Stage, topo: Topo): Marks {
  const { renderer, root, render } = stage;
  const marks = new THREE.Group();
  root.add(marks);
  const PICKED = 0xff8a1f;
  const roundDot = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(16, 16, 15, 0, Math.PI * 2);
    g.fill();
    return new THREE.CanvasTexture(c);
  })();
  const looks = {
    face: [HOVER, PICKED].map((color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
    // Edges: 3 px wide lines (plain WebGL lines are always 1 px) (Harel, 2026-11-09).
    line: [HOVER, PICKED].map((color) => new LineMaterial({ color, linewidth: 3, depthTest: false, transparent: true })),
    // Points: a small round dot of fixed size on screen, whatever the zoom, like Onshape's
    // (Harel, 2026-11-09).
    dot: [HOVER, PICKED].map((color) => new THREE.PointsMaterial({ color, size: 7, sizeAttenuation: false, map: roundDot, alphaTest: 0.5, depthTest: false, transparent: true })),
    gap: new THREE.LineDashedMaterial({ color: 0xffd23f, dashSize: 0.004, gapSize: 0.003, depthTest: false, transparent: true }),
  };
  // Lines and dots are made per draw; face geometries are kept (topo.faceGeom).
  const clearMarks = () => {
    for (const c of marks.children) if ((c as THREE.Line).isLine || (c as THREE.Points).isPoints || (c as Line2).isLine2) (c as THREE.Mesh).geometry.dispose();
    marks.clear();
  };
  const draw = (hover: Pick | null, chosen: Pick[], line: [V3, V3] | null) => {
    clearMarks();
    const one = (pk: Pick, lit: number) => {
      const at = topo.placeOf(pk.m, pk.i);
      const t = topo.topoOf(pk.m);
      let obj: THREE.Object3D;
      if (pk.kind === "face") obj = new THREE.Mesh(topo.faceGeom(pk.m, pk.n), looks.face[lit]);
      else if (pk.kind === "edge") {
        const e = t.edges[pk.n];
        const pts = (e.closed ? [...e.points, e.points[0]] : e.points).flat();
        const size = renderer.getSize(new THREE.Vector2());
        looks.line[lit].resolution.set(size.x, size.y);
        obj = new Line2(new LineGeometry().setPositions(pts), looks.line[lit]);
      } else {
        obj = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...t.corners[pk.n])]), looks.dot[lit]);
      }
      obj.matrix.premultiply(at);
      obj.matrixAutoUpdate = false;
      obj.renderOrder = 12;
      marks.add(obj);
    };
    if (hover && !chosen.some((q) => samePick(q, hover))) one(hover, 0);
    for (const pk of chosen) one(pk, 1);
    if (line) {
      const gap = new THREE.Line(new THREE.BufferGeometry().setFromPoints(line.map((q) => new THREE.Vector3(...q))), looks.gap);
      gap.computeLineDistances();
      gap.renderOrder = 13;
      marks.add(gap);
    }
    render();
  };
  return {
    draw,
    dispose: () => {
      clearMarks();
      [...looks.face, ...looks.line, ...looks.dot, looks.gap].forEach((m) => m.dispose());
      roundDot.dispose();
    },
  };
}

// The selected part (a click on it): drawn solid in bright green over its instances (every copy).
export type Selection = { select: (key: string | null) => void; refresh: () => void };

export function createSelection(stage: Stage, meshes: PartMesh[], looks: Looks): Selection {
  const picks = new THREE.Group();
  stage.root.add(picks);
  let selectedNow: string | null = null;
  const draw = (key: string | null) => {
    picks.clear();
    if (key) {
      for (const { mesh, keys } of meshes) {
        keys.forEach((k, i) => {
          if (k !== key) return;
          const lit = new THREE.Mesh(mesh.geometry, looks.glow);
          mesh.getMatrixAt(i, lit.matrix);
          lit.matrixAutoUpdate = false;
          lit.visible = mesh.visible;
          lit.userData.of = mesh;
          picks.add(lit);
        });
      }
    }
    stage.render();
  };
  return { select: (key) => draw((selectedNow = key)), refresh: () => draw(selectedNow) };
}

export type Picking = { setHover: (h: { m: number; i: number } | null) => void; dispose: () => void };

// The part under the mouse, washed over its own surfaces; clicks, double-clicks and Y on the
// canvas. With a mouse, Y hides the part under it, Shift+Y brings back the last one hidden (again
// for the one before) (Harel, 2026-11-07).
export function createPicking(
  stage: Stage,
  meshes: PartMesh[],
  topo: Topo,
  measure: () => MeasureLayer,
  on: {
    pick: (key: string | null) => void; // a click on a part (its key) or on empty space (null)
    open: () => ((key: string) => void) | undefined; // a double-click on a part, when the page takes it
    hide: (g: Gone) => void;
    showLast: () => void;
  },
): Picking {
  const { renderer, root, camera, render } = stage;
  const hoverLook = new THREE.MeshBasicMaterial({
    color: HOVER,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const hoverLayer = new THREE.Group();
  root.add(hoverLayer);
  let hovered: { m: number; i: number } | null = null;
  const setHover = (h: { m: number; i: number } | null) => {
    if (h?.m === hovered?.m && h?.i === hovered?.i) return;
    hovered = h;
    hoverLayer.clear();
    if (h) {
      const { mesh } = meshes[h.m];
      const lit = new THREE.Mesh(mesh.geometry, hoverLook);
      mesh.getMatrixAt(h.i, lit.matrix);
      lit.matrixAutoUpdate = false;
      hoverLayer.add(lit);
    }
    render();
  };

  // Left click (not a drag) chooses the part under the pointer; a double-click opens it.
  const ray = new THREE.Raycaster();
  const hitAt = (e: MouseEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1)), camera);
    const [hit] = ray.intersectObjects(
      meshes.filter((m) => m.mesh.visible).map((m) => m.mesh),
      false,
    );
    const m = hit ? meshes.findIndex((x) => x.mesh === hit.object) : -1;
    return m >= 0 && hit.instanceId !== undefined ? { m, i: hit.instanceId, point: hit.point, tri: hit.faceIndex ?? 0 } : null;
  };
  const keyAt = (e: MouseEvent) => {
    const h = hitAt(e);
    return h ? (meshes[h.m].keys[h.i] ?? null) : null;
  };
  // The face, edge or corner under the pointer, by the filter, on the part the ray meets: corners
  // and edges within a few pixels of it on screen (more for a finger).
  const pickAt = (e: MouseEvent, finger: boolean, filter: MeasureFilter | null): Pick | null => {
    const h = hitAt(e);
    if (!h || !filter) return null;
    const t = topo.topoOf(h.m);
    const toScreen = topo.placeOf(h.m, h.i).premultiply(root.matrixWorld);
    const rect = renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const v = new THREE.Vector3();
    const screen = (q: V3): [number, number] => {
      v.set(q[0], q[1], q[2]).applyMatrix4(toScreen).project(camera);
      return [((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height];
    };
    if (filter === "any" || filter === "point") {
      let best = finger ? 22 : 10;
      let n = -1;
      t.corners.forEach((q, k) => {
        const [sx, sy] = screen(q);
        const d = Math.hypot(sx - x, sy - y);
        if (d < best) [best, n] = [d, k];
      });
      if (n >= 0) return { m: h.m, i: h.i, kind: "point", n };
    }
    if (filter === "any" || filter === "edge") {
      let best = finger ? 22 : 11;
      let n = -1;
      t.edges.forEach((ed, k) => {
        const pts = ed.points.map(screen);
        const count = ed.closed ? pts.length : pts.length - 1;
        for (let j = 0; j < count; j++) {
          const [ax, ay] = pts[j];
          const [bx, by] = pts[(j + 1) % pts.length];
          const dx = bx - ax, dy = by - ay;
          const l2 = dx * dx + dy * dy;
          const u = l2 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
          const d = Math.hypot(ax + u * dx - x, ay + u * dy - y);
          if (d < best) [best, n] = [d, k];
        }
      });
      if (n >= 0) return { m: h.m, i: h.i, kind: "edge", n };
    }
    if (filter === "any" || filter === "face") return { m: h.m, i: h.i, kind: "face", n: t.triFace[h.tri] };
    return null;
  };
  // Hover: one ray per frame at most, mouse only, not while dragging.
  let over = false;
  let frame = 0;
  const onMove = (e: PointerEvent) => {
    over = true;
    cancelAnimationFrame(frame);
    if (e.pointerType !== "mouse" || e.buttons) return setHover(null);
    frame = requestAnimationFrame(() => {
      const filter = measure().filter();
      if (filter) {
        const pk = pickAt(e, false, filter);
        if (!measure().hover(pk)) return;
        // Y hides the part under the pointer here too.
        hovered = pk && { m: pk.m, i: pk.i };
        return;
      }
      const h = hitAt(e);
      setHover(h && { m: h.m, i: h.i });
    });
  };
  const onLeave = () => {
    over = false;
    cancelAnimationFrame(frame);
    setHover(null);
    measure().hover(null);
  };
  // Y (by key position, so it works on a Hebrew layout too) while the mouse is on the model.
  const onKey = (e: KeyboardEvent) => {
    if (!over || e.code !== "KeyY" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]")) return;
    if (e.shiftKey) on.showLast();
    else {
      if (!hovered) return;
      on.hide({ m: hovered.m, i: hovered.i, key: meshes[hovered.m].keys[hovered.i] });
    }
    e.preventDefault();
  };
  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => {
    down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  };
  const onUp = (e: PointerEvent) => {
    if (!down || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
    down = null;
    const filter = measure().filter();
    if (filter) {
      measure().tap(pickAt(e, e.pointerType !== "mouse", filter));
      return;
    }
    on.pick(keyAt(e));
  };
  const onDouble = (e: MouseEvent) => {
    const open = on.open();
    if (e.button !== 0 || !open || measure().filter()) return;
    const key = keyAt(e);
    if (key) open(key);
  };
  const canvas = renderer.domElement;
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  window.addEventListener("keydown", onKey);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("dblclick", onDouble);

  return {
    setHover,
    dispose: () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("dblclick", onDouble);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(frame);
      hoverLook.dispose();
    },
  };
}
