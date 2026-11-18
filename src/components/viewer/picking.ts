// Picking: the ray from the pointer, the part under the mouse (washed in light blue), the selected
// part (bright green), faces / edges / corners under the pointer, the marks drawn on them, and the
// pointer, menu and Y keys on the canvas.
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { topology, type Topology, type V3 } from "@/lib/model/topology";
import type { MeasureLayer } from "./measureLayer";
import { HOVER, type Looks } from "./paint";
import { nearestCorner, nearestOnLine, seen, seenTolerance, type ScreenPoint } from "./pickSeen";
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
      // Worked out by load.ts's worker when it got there first; else here, on first use.
      t = (g.userData.topology as Topology | undefined) ?? topology(g.getAttribute("position").array, g.index!.array);
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

// The picked faces, edges and corners (hover blue, picked orange), whole parts picked with a box
// (washed orange), and the measured gap.
export type Marks = {
  draw: (hover: Pick | null, chosen: Pick[], line: [V3, V3] | null, parts?: { m: number; i: number }[]) => void;
  dispose: () => void;
};

export function createMarks(stage: Stage, meshes: PartMesh[], topo: Topo): Marks {
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
    part: new THREE.MeshBasicMaterial({ color: PICKED, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    gap: new THREE.LineDashedMaterial({ color: 0xffd23f, dashSize: 0.004, gapSize: 0.003, depthTest: false, transparent: true }),
  };
  // Lines and dots are made per draw; face geometries are kept (topo.faceGeom).
  const clearMarks = () => {
    for (const c of marks.children) if ((c as THREE.Line).isLine || (c as THREE.Points).isPoints || (c as Line2).isLine2) (c as THREE.Mesh).geometry.dispose();
    marks.clear();
  };
  const draw = (hover: Pick | null, chosen: Pick[], line: [V3, V3] | null, parts: { m: number; i: number }[] = []) => {
    clearMarks();
    for (const p of parts) {
      const lit = new THREE.Mesh(meshes[p.m].mesh.geometry, looks.part);
      lit.matrix.copy(topo.placeOf(p.m, p.i));
      lit.matrixAutoUpdate = false;
      lit.renderOrder = 11;
      marks.add(lit);
    }
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
      [...looks.face, ...looks.line, ...looks.dot, looks.part, looks.gap].forEach((m) => m.dispose());
      roundDot.dispose();
    },
  };
}

// The selected part (a click on it): drawn solid in bright green over its instances (every copy).
// A BOM page's Bulk edit selects many at once.
export type Selection = { select: (keys: string | readonly string[] | null) => void; refresh: () => void };

export function createSelection(stage: Stage, meshes: PartMesh[], looks: Looks): Selection {
  const picks = new THREE.Group();
  stage.root.add(picks);
  let selectedNow: string | readonly string[] | null = null;
  const draw = (chosen: string | readonly string[] | null) => {
    picks.clear();
    const want = new Set(chosen === null ? [] : typeof chosen === "string" ? [chosen] : chosen);
    if (want.size) {
      for (const { mesh, keys } of meshes) {
        keys.forEach((k, i) => {
          if (!want.has(k)) return;
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
  return { select: (keys) => draw((selectedNow = keys)), refresh: () => draw(selectedNow) };
}

// Where a context menu opens (client px) and the part copy under it, if any.
// `face`: the flat face under it (the clicked point and its outward normal, model frame), for
// Section view. `round`: the round face under it (a point on its axis, the axis and the clicked
// point, model frame), for a Section view through its axis like Onshape's.
export type RoundFace = { axisPoint: V3; axis: V3; point: V3 };
export type MenuAt = {
  x: number;
  y: number;
  under: Gone | null;
  face: { point: V3; normal: V3 } | null; // a flat face under the pointer (model frame)
  axis: V3 | null; // a round face's axis, from its end nearer the camera (model frame): View normal to
  round: RoundFace | null; // the same round face, for a Section view through its axis
  // Select other, like Onshape's: every part copy along the ray, front first; choosing one picks
  // it (in measuring, its face, edge or corner there), hovering one lights it.
  layers: Gone[];
  choose: (k: number) => void;
  light: (k: number | null) => void;
};
// What the context menu acts on: the part copy under it and its part, or every picked part when
// that part is one of them; how many copies the part has, and what's hidden / isolated now.
export type MenuTarget = MenuAt & {
  keys: string[];
  copies: number;
  hidden: number;
  hiddenCopies: number; // copies of the part under the pointer hidden now (Show other instances)
  isolated: { keys: string[]; ghost: number } | null;
};

export type Picking = { setHover: (h: { m: number; i: number } | null) => void; dispose: () => void };

const LONG_PRESS_MS = 500;
const LABEL_MS = 400;
const CLICK_PX = 4; // a press that moved less than this is a click, not a drag

// The part under the mouse, washed over its own surfaces; clicks, double-clicks, right-click and
// long-press menus, box select and Y on the canvas. With a mouse, Y hides the part under it,
// Shift+Y brings back the hidden part under it: hidden copies are tested at their kept places and
// the one there shows as a faint dashed outline, even behind a shown part (Harel, 2026-11-10).
export function createPicking(
  stage: Stage,
  meshes: PartMesh[],
  topo: Topo,
  measure: () => MeasureLayer,
  on: {
    pick: (key: string | null) => void; // a click on a part (its key) or on empty space (null)
    open: () => ((key: string) => void) | undefined; // a double-click on a part, when the page takes it
    boxed?: () => ((keys: string[], drop: boolean) => void) | undefined; // box select with no face picking, when the page takes it
    hide: (g: Gone) => void;
    hiddenAt: (ray: THREE.Raycaster) => { g: Gone; at: THREE.Matrix4 } | null;
    anyHidden: () => boolean;
    showHidden: (g: Gone) => void;
    names: () => Map<string, string> | undefined;
    menu: (at: MenuAt) => void; // right-click without a drag, or a long press
    hovered?: (key: string | null) => void; // the part under the mouse changed (the Assembly page lights its sub-assembly)
    sectionTap?: (e: MouseEvent) => boolean; // a click, taken by the Section view panel while it is open (no pick then)
    // While a section is on: whether a hit point (world space) is on what the cut keeps. Hits on
    // the cut-away side are skipped, so hover, picks and measuring reach the surface that shows.
    kept?: () => ((p: THREE.Vector3) => boolean) | null;
  },
): Picking {
  const { el, renderer, root, render } = stage;
  const canvas = renderer.domElement;
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
  // A Geometry sketch under the mouse: its lines and points in the hover blue (it has no faces).
  const hoverSketch = { line: new THREE.LineBasicMaterial({ color: HOVER, depthTest: false, transparent: true }), dot: new THREE.PointsMaterial({ color: HOVER, size: 7, sizeAttenuation: false, depthTest: false, transparent: true }) };
  let hovered: { m: number; i: number } | null = null;
  const setHover = (h: { m: number; i: number } | null) => {
    if (h?.m === hovered?.m && h?.i === hovered?.i) return;
    hovered = h;
    on.hovered?.(h ? meshes[h.m].keys[h.i] : null);
    hoverLayer.clear();
    // A part hidden while measuring: its blue face / edge mark goes with it.
    if (!h) measure()?.hover(null);
    if (h && meshes[h.m].sketch) {
      for (const c of meshes[h.m].mesh.children) {
        const lit = (c as THREE.Points).isPoints ? new THREE.Points((c as THREE.Points).geometry, hoverSketch.dot) : new THREE.LineSegments((c as THREE.LineSegments).geometry, hoverSketch.line);
        lit.renderOrder = 12;
        lit.raycast = () => {};
        hoverLayer.add(lit);
      }
    } else if (h) {
      const { mesh } = meshes[h.m];
      const lit = new THREE.Mesh(mesh.geometry, hoverLook);
      mesh.getMatrixAt(h.i, lit.matrix);
      lit.matrixAutoUpdate = false;
      hoverLayer.add(lit);
    }
    render();
  };

  // The hidden part under the mouse (what Shift+Y brings back): a faint fill and dashed borders.
  const outlineLayer = new THREE.Group();
  root.add(outlineLayer);
  const outlineFill = new THREE.MeshBasicMaterial({ color: HOVER, transparent: true, opacity: 0.1, depthTest: false, depthWrite: false });
  const outlineLine = new THREE.LineDashedMaterial({ color: HOVER, dashSize: 0.004, gapSize: 0.003, transparent: true, opacity: 0.8, depthTest: false });
  const borders = new Map<THREE.InstancedMesh, THREE.BufferGeometry | null>();
  const bordersOf = (mesh: THREE.InstancedMesh) => {
    if (!borders.has(mesh)) {
      const segs = mesh.children.find((c) => (c as THREE.LineSegments).isLineSegments) as THREE.LineSegments | undefined;
      let g: THREE.BufferGeometry | null = null;
      if (segs) {
        g = new THREE.BufferGeometry();
        g.setAttribute("position", segs.geometry.getAttribute("position"));
      }
      borders.set(mesh, g);
    }
    return borders.get(mesh)!;
  };
  let under: Gone | null = null;
  const setOutline = (h: { g: Gone; at: THREE.Matrix4 } | null) => {
    if (h?.g.m === under?.m && h?.g.i === under?.i) return;
    under = h?.g ?? null;
    outlineLayer.clear();
    if (h) {
      const { mesh } = meshes[h.g.m];
      const parts: THREE.Object3D[] = [new THREE.Mesh(mesh.geometry, outlineFill)];
      const g = bordersOf(mesh);
      if (g) {
        const lines = new THREE.LineSegments(g, outlineLine);
        lines.computeLineDistances();
        parts.push(lines);
      }
      for (const o of parts) {
        o.matrix.copy(h.at);
        o.matrixAutoUpdate = false;
        o.renderOrder = 14;
        o.raycast = () => {};
        outlineLayer.add(o);
      }
    }
    render();
  };

  // The ray from the pointer, and every part copy along it, nearest first (each copy once).
  const ray = new THREE.Raycaster();
  const aim = (x: number, y: number) => {
    const rect = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1)), stage.camera);
    ray.firstHitOnly = false;
    return ray;
  };
  // `tri` -1: a Geometry sketch, which has no faces.
  type Hit = { m: number; i: number; tri: number; point: THREE.Vector3 };
  // Geometry sketches (sketches.ts) have nothing for a ray to hit: one is under the pointer when
  // one of its lines or points is within a few pixels of it on screen, nearest first. They come
  // before the parts, like Onshape picks a sketch line over the face behind it.
  const SKETCH_REACH = 12;
  const sketchHits = (e: { clientX: number; clientY: number }, kept: ((p: THREE.Vector3) => boolean) | null): Hit[] => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const v = new THREE.Vector3();
    const found: (Hit & { d: number })[] = [];
    meshes.forEach((pm, m) => {
      if (!pm.sketch || !pm.mesh.visible) return;
      const toWorld = topo.placeOf(m, 0);
      if (Math.abs(toWorld.determinant()) < 1e-12) return; // hidden with Y
      toWorld.premultiply(root.matrixWorld);
      const t = topo.topoOf(m);
      const screen = (q: V3): [number, number] | null => {
        v.set(q[0], q[1], q[2]).applyMatrix4(toWorld);
        if (kept && !kept(v)) return null;
        v.project(stage.camera);
        return v.z > 1 ? null : [((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height];
      };
      let best = SKETCH_REACH;
      let at: V3 | null = null;
      for (const q of t.corners) {
        const s = screen(q);
        const d = s ? Math.hypot(s[0] - x, s[1] - y) : Infinity;
        if (d < best) [best, at] = [d, q];
      }
      for (const ed of t.edges) {
        const pts = ed.points.map(screen);
        const count = ed.closed ? pts.length : pts.length - 1;
        for (let j = 0; j < count; j++) {
          const a = pts[j];
          const b = pts[(j + 1) % pts.length];
          if (!a || !b) continue;
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const l2 = dx * dx + dy * dy;
          const u = l2 ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
          const d = Math.hypot(a[0] + u * dx - x, a[1] + u * dy - y);
          if (d < best) {
            const p = ed.points[j], q = ed.points[(j + 1) % ed.points.length];
            [best, at] = [d, [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u]];
          }
        }
      }
      if (at) found.push({ m, i: 0, tri: -1, point: new THREE.Vector3(...at).applyMatrix4(toWorld), d: best });
    });
    return found.sort((a, b) => a.d - b.d).map(({ m, i, tri, point }) => ({ m, i, tri, point }));
  };
  // `all`: every part along the ray (Select other); else the BVH stops at each mesh's nearest hit.
  const hitsAt = (e: { clientX: number; clientY: number }, all = false): Hit[] => {
    aim(e.clientX, e.clientY);
    const kept = on.kept?.() ?? null;
    const sketches = sketchHits(e, kept);
    // With a section the nearest hit on a mesh may be cut away, so every hit is needed.
    ray.firstHitOnly = !all && !kept;
    const out: Hit[] = [];
    for (const hit of ray.intersectObjects(
      meshes.filter((m) => m.mesh.visible).map((m) => m.mesh),
      false,
    )) {
      const m = meshes.findIndex((x) => x.mesh === hit.object);
      if (m < 0 || hit.instanceId === undefined || out.some((h) => h.m === m && h.i === hit.instanceId)) continue;
      if (kept && !kept(hit.point)) continue;
      out.push({ m, i: hit.instanceId, tri: hit.faceIndex ?? 0, point: hit.point });
    }
    return [...sketches, ...out];
  };
  const hitAt = (e: { clientX: number; clientY: number }) => hitsAt(e)[0] ?? null;
  // The size of one screen pixel in world units at a depth (orthographic: the same everywhere).
  const pixelWorld = (depth: number, height: number) => {
    const cam = stage.camera;
    const h = Math.max(1, height);
    if (cam.ortho) return (2 * cam.orthoHalf) / cam.zoom / h;
    if (!Number.isFinite(depth)) return 0;
    return (2 * depth * Math.tan((cam.fov * Math.PI) / 360)) / cam.zoom / h;
  };
  const keyOf = (h: { m: number; i: number } | null | undefined) => (h ? (meshes[h.m].keys[h.i] ?? null) : null);
  // The face, edge or corner under the pointer, by the filter, on the `depth`-th part the ray
  // meets (0: the front one): corners and edges within a few pixels of it on screen (more for a
  // finger).
  const pickAt = (e: { clientX: number; clientY: number }, finger: boolean, filter: MeasureFilter | null, depth = 0): Pick | null => {
    const h = hitsAt(e, depth > 0)[depth];
    if (!h || !filter) return null;
    const t = topo.topoOf(h.m);
    const toScreen = topo.placeOf(h.m, h.i).premultiply(root.matrixWorld);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const v = new THREE.Vector3();
    const view = stage.camera.matrixWorldInverse;
    // On screen (px) and the depth from the camera along the view (world units).
    const screen = (q: V3): ScreenPoint => {
      v.set(q[0], q[1], q[2]).applyMatrix4(toScreen);
      const d = -v.clone().applyMatrix4(view).z;
      v.project(stage.camera);
      return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height, d };
    };
    // With a section on, corners and edge pieces the cut takes away don't snap: they aren't drawn.
    const kept = on.kept?.() ?? null;
    const w = new THREE.Vector3();
    const shows = (q: V3) => !kept || kept(w.set(q[0], q[1], q[2]).applyMatrix4(toScreen));
    // Only what can be seen pre-selects, like Onshape: no further than the hit surface (plus a
    // little), or on the hit face's border. Sketches have no faces to hide behind.
    const face = h.tri >= 0 ? t.triFace[h.tri] : -1;
    const hitDepth = h.tri >= 0 ? -h.point.clone().applyMatrix4(view).z : Infinity;
    const tol = seenTolerance(pixelWorld(hitDepth, rect.height));
    const visible = (p: ScreenPoint) => seen(p.d, hitDepth, tol);
    if (filter === "any" || filter === "point") {
      // A corner on the hit face's border: an end of one of its border edges.
      const rim = new Set<string>();
      if (face >= 0) for (const ed of t.edges) if (ed.faces[0] === face || ed.faces[1] === face) for (const q of [ed.points[0], ed.points[ed.points.length - 1]]) rim.add(q.map((c) => Math.round(c * 1e6)).join());
      const { n } = nearestCorner(t.corners.map(screen), x, y, finger ? 22 : 10, (k, p) => shows(t.corners[k]) && (visible(p) || rim.has(t.corners[k].map((c) => Math.round(c * 1e6)).join())));
      if (n >= 0) return { m: h.m, i: h.i, kind: "point", n };
    }
    if (filter === "any" || filter === "edge") {
      let best = finger ? 22 : 11;
      let n = -1;
      t.edges.forEach((ed, k) => {
        const border = face >= 0 && (ed.faces[0] === face || ed.faces[1] === face);
        const cut = kept ? ed.points.map(shows) : null;
        const d = nearestOnLine(ed.points.map(screen), ed.closed, x, y, (p) => border || visible(p), (j) => !cut || cut[j] || cut[(j + 1) % cut.length]);
        if (d < best) [best, n] = [d, k];
      });
      if (n >= 0) return { m: h.m, i: h.i, kind: "edge", n };
    }
    if (h.tri < 0) return null; // a sketch: lines and points only
    if (filter === "any" || filter === "face") return { m: h.m, i: h.i, kind: "face", n: t.triFace[h.tri] };
    return null;
  };

  // The part's name by the pointer after a short rest (mouse only).
  const label = document.createElement("div");
  label.className = "pointer-events-none absolute z-20 hidden max-w-64 truncate rounded border border-line bg-surface/95 px-1.5 py-0.5 text-xs font-medium text-fg shadow-sm backdrop-blur";
  el.appendChild(label);
  let labelTimer = 0;
  const hideLabel = () => {
    clearTimeout(labelTimer);
    label.classList.add("hidden");
  };
  const labelLater = (x: number, y: number) => {
    hideLabel();
    labelTimer = window.setTimeout(() => {
      const names = on.names();
      const key = keyOf(hovered);
      const sketch = hovered ? meshes[hovered.m]?.sketch : undefined;
      if (!key || (!names && !sketch)) return;
      label.textContent = sketch ? `Sketch · ${sketch.name}` : (names!.get(key) ?? "Placed in CAD, not on the BOM");
      label.classList.remove("hidden");
      const r = el.getBoundingClientRect();
      const left = Math.min(x - r.left + 14, r.width - label.offsetWidth - 4);
      const below = y - r.top + 18;
      const top = below + label.offsetHeight > r.height ? y - r.top - label.offsetHeight - 8 : below;
      label.style.left = `${Math.max(4, left)}px`;
      label.style.top = `${Math.max(4, top)}px`;
    }, LABEL_MS);
  };

  // Long press (touch): the menu, and the lift that ends it picks nothing. Where box select works,
  // the hold is `held` first: a drag from there draws a box, a lift without one opens the menu
  // (Harel, 2026-11-17).
  let press: { x: number; y: number; timer: number } | null = null;
  let pressed = false;
  let held: { x: number; y: number; id: number } | null = null;
  const canBox = () => !!measure().filter() || !!on.boxed?.();
  const touches = new Set<number>();
  const cancelPress = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };
  const menuAt = (x: number, y: number, finger: boolean) => {
    hideLabel();
    const pt = { clientX: x, clientY: y };
    const layers = hitsAt(pt, true);
    const h = layers[0] ?? null;
    let face: MenuAt["face"] = null;
    let axis: MenuAt["axis"] = null;
    const f = h && topo.topoOf(h.m).faces[topo.topoOf(h.m).triFace[h.tri]];
    if (h && f) {
      const turn = new THREE.Matrix3().getNormalMatrix(topo.placeOf(h.m, h.i));
      if (f.kind === "plane" && f.normal) {
        const normal = new THREE.Vector3(...f.normal).applyMatrix3(turn).normalize();
        face = { point: root.worldToLocal(h.point.clone()).toArray() as V3, normal: normal.toArray() as V3 };
      } else if (f.kind === "cylinder" && f.axis) {
        const a = new THREE.Vector3(...f.axis).applyMatrix3(turn).normalize();
        // From the end nearer the camera, so the view doesn't turn over.
        const back = stage.camera.getWorldDirection(new THREE.Vector3()).negate().transformDirection(root.matrixWorld.clone().invert());
        axis = (a.dot(back) < 0 ? a.negate() : a).toArray() as V3;
      }
    }
    let round: RoundFace | null = null;
    if (h && f?.kind === "cylinder" && f.axis && f.point) {
      const at = topo.placeOf(h.m, h.i);
      round = {
        axisPoint: new THREE.Vector3(...f.point).applyMatrix4(at).toArray() as V3,
        axis: new THREE.Vector3(...f.axis).transformDirection(at).toArray() as V3,
        point: root.worldToLocal(h.point.clone()).toArray() as V3,
      };
    }
    const gone = (l: Hit): Gone => ({ m: l.m, i: l.i, key: meshes[l.m].keys[l.i] });
    on.menu({
      x,
      y,
      under: h && gone(h),
      face,
      axis,
      round,
      layers: layers.map(gone),
      choose: (k) => {
        setHover(null);
        const filter = measure().filter();
        if (filter) measure().tap(pickAt(pt, finger, filter, k));
        else on.pick(keyOf(layers[k]));
      },
      light: (k) => setHover(k === null ? null : (layers[k] ?? null)),
    });
  };

  // Hover: one ray per frame at most, mouse only, not while dragging.
  let over = false;
  let frame = 0;
  const onMove = (e: PointerEvent) => {
    over = true;
    cancelAnimationFrame(frame);
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) cancelPress();
    hideLabel();
    if (e.pointerType !== "mouse" || e.buttons) {
      setOutline(null);
      return setHover(null);
    }
    frame = requestAnimationFrame(() => {
      setOutline(on.anyHidden() ? on.hiddenAt(aim(e.clientX, e.clientY)) : null);
      const filter = measure().filter();
      if (filter) {
        const pk = pickAt(e, false, filter);
        // Y hides the part under the pointer here too.
        measure().hover(pk);
        hovered = pk && { m: pk.m, i: pk.i };
      } else {
        const h = hitAt(e);
        setHover(h && { m: h.m, i: h.i });
      }
      labelLater(e.clientX, e.clientY);
    });
  };
  const onLeave = () => {
    over = false;
    cancelAnimationFrame(frame);
    hideLabel();
    setOutline(null);
    setHover(null);
    measure().hover(null);
  };
  // Y (by key position, so it works on a Hebrew layout too) while the mouse is on the model.
  const onKey = (e: KeyboardEvent) => {
    if (!over || e.code !== "KeyY" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]")) return;
    hideLabel();
    if (e.shiftKey) {
      // Nothing hidden under the mouse: nothing happens.
      if (!under) return;
      const g = under;
      setOutline(null);
      on.showHidden(g);
    } else {
      if (!hovered) return;
      on.hide({ m: hovered.m, i: hovered.i, key: meshes[hovered.m].keys[hovered.i] });
    }
    e.preventDefault();
  };

  let down: { x: number; y: number; button: number } | null = null;
  // Touch, like Onshape's app: a two-finger tap opens the menu (between the fingers), a double tap
  // anywhere clears every pick. `pair`: two fingers down together; `starts`: where each began.
  const starts = new Map<number, { x: number; y: number }>();
  let pair: { t: number; x: number; y: number; moved: boolean } | null = null;
  let lastTouchTap = { t: 0, x: 0, y: 0 };
  const onDown = (e: PointerEvent) => {
    hideLabel();
    down = { x: e.clientX, y: e.clientY, button: e.button };
    if (e.pointerType === "mouse") return;
    touches.add(e.pointerId);
    starts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cancelPress();
    pressed = false;
    if (touches.size === 2) {
      const [p, q] = [...starts.values()];
      pair = { t: performance.now(), x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, moved: false };
      down = null; // not a one-finger tap any more
    } else if (touches.size > 2) pair = null;
    held = null;
    if (touches.size === 1) {
      const { clientX: x, clientY: y, pointerId: id } = e;
      press = {
        x,
        y,
        timer: window.setTimeout(() => {
          press = null;
          pressed = true;
          if (!canBox()) return menuAt(x, y, true);
          held = { x, y, id };
          navigator.vibrate?.(12);
        }, LONG_PRESS_MS),
      };
    }
  };
  const onTouchMove = (e: PointerEvent) => {
    const s0 = starts.get(e.pointerId);
    if (pair && s0 && Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 8) pair.moved = true;
  };
  const onUp = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    starts.delete(e.pointerId);
    cancelPress();
    if (held) {
      const h = held;
      held = null;
      if (!box) menuAt(h.x, h.y, true);
    }
    if (pair) {
      if (touches.size) return;
      const p = pair;
      pair = null;
      if (!p.moved && performance.now() - p.t < 400) menuAt(p.x, p.y, true);
      return;
    }
    const d = down;
    down = null;
    if (!d || d.button !== e.button) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX) return;
    if (e.button === 2 && e.pointerType === "mouse") return menuAt(e.clientX, e.clientY, false);
    if (e.button !== 0) return;
    if (pressed) {
      pressed = false;
      return;
    }
    if (on.sectionTap?.(e)) return;
    const finger = e.pointerType !== "mouse";
    const filter = measure().filter();
    if (finger) {
      const now = performance.now();
      const again = now - lastTouchTap.t < 350 && Math.hypot(e.clientX - lastTouchTap.x, e.clientY - lastTouchTap.y) < 30;
      lastTouchTap = again ? { t: 0, x: 0, y: 0 } : { t: now, x: e.clientX, y: e.clientY };
      if (again) return filter ? measure().tap(null) : on.pick(null);
    }
    // A click picks what's under the pointer and a click on a pick drops it, like Onshape (the
    // parts behind: Select other in the menu); a click on empty space clears.
    if (filter) return measure().tap(pickAt(e, finger, filter, 0));
    on.pick(keyOf(hitAt(e)));
  };
  const onCancel = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    starts.delete(e.pointerId);
    cancelPress();
    held = null;
    down = null;
    pair = null;
  };
  const onDouble = (e: MouseEvent) => {
    const open = on.open();
    if (e.button !== 0 || !open || measure().filter()) return;
    const key = keyOf(hitAt(e));
    if (key) open(key);
  };
  const onMenu = (e: MouseEvent) => e.preventDefault(); // ours opens on pointerup (or a long press)
  const onWheel = () => hideLabel();

  // Box select, Onshape's: a left drag from empty space (no key needed). Dragged left to right it
  // takes the part copies wholly inside the box (blue), right to left every one it touches
  // (orange); with Ctrl (Cmd) it takes them off instead (while picking faces, as on the CAD page).
  // Caught before the camera controls. With no face picking, the page may take whole parts
  // (on.boxed: a BOM page's Bulk edit). On touch: hold still, then drag (`held`).
  let box: { x: number; y: number; div: HTMLDivElement; drop: boolean; touch: boolean } | null = null;
  const boxRect = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const x0 = Math.min(box!.x, e.clientX) - r.left;
    const y0 = Math.min(box!.y, e.clientY) - r.top;
    return { x0, y0, x1: x0 + Math.abs(e.clientX - box!.x), y1: y0 + Math.abs(e.clientY - box!.y) };
  };
  const boxLook = (crossing: boolean) =>
    `pointer-events-none absolute z-20 border ${crossing ? "border-dashed border-orange-500 bg-orange-500/10" : "border-solid border-accent bg-accent/10"}`;
  const onBoxMove = (e: PointerEvent) => {
    if (!box) return;
    const { x0, y0, x1, y1 } = boxRect(e);
    box.div.className = boxLook(e.clientX < box.x);
    Object.assign(box.div.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
  };
  const onBoxUp = (e: PointerEvent) => {
    if (!box) return;
    const { x0, y0, x1, y1 } = boxRect(e);
    const crossing = e.clientX < box.x;
    const { drop, touch } = box;
    box.div.remove();
    box = null;
    window.removeEventListener("pointermove", onBoxMove);
    window.removeEventListener("pointerup", onBoxUp);
    window.removeEventListener("pointercancel", onBoxUp);
    if (x1 - x0 < CLICK_PX && y1 - y0 < CLICK_PX) {
      // No drag: a click on empty space, which clears (the canvas never saw the press). A finger
      // that came back to where it was held drew nothing.
      if (touch) return;
      if (!drop && !on.sectionTap?.(e)) measure().tap(null);
      return;
    }
    const r = canvas.getBoundingClientRect();
    const toScreen = (q: THREE.Vector3): [number, number] | null => {
      q.project(stage.camera);
      return q.z > 1 ? null : [((q.x + 1) / 2) * r.width, ((1 - q.y) / 2) * r.height];
    };
    const inBox = (p: [number, number] | null) => !!p && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
    // Crossing: a copy under the box's middle counts too (a box drawn inside one big face).
    const middle = crossing ? hitsAt({ clientX: r.left + (x0 + x1) / 2, clientY: r.top + (y0 + y1) / 2 }, true) : [];
    const found: { m: number; i: number }[] = [];
    const at = new THREE.Matrix4();
    const q = new THREE.Vector3();
    meshes.forEach(({ mesh, sketch }, m) => {
      if (!mesh.visible || sketch) return;
      const g = mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const { min, max } = g.boundingBox!;
      const pos = g.getAttribute("position");
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, at);
        if (Math.abs(at.determinant()) < 1e-12) continue; // hidden (drawn at no size)
        at.premultiply(mesh.matrixWorld);
        const corners = Array.from({ length: 8 }, (_, c) => toScreen(q.set(c & 1 ? max.x : min.x, c & 2 ? max.y : min.y, c & 4 ? max.z : min.z).applyMatrix4(at)));
        if (corners.every(inBox)) {
          found.push({ m, i });
          continue;
        }
        if (!crossing) continue;
        if (middle.some((h) => h.m === m && h.i === i)) {
          found.push({ m, i });
          continue;
        }
        // The copy's screen box must meet the box before its points are worth a look.
        const xs = corners.filter((p) => p).map((p) => p![0]);
        const ys = corners.filter((p) => p).map((p) => p![1]);
        if (!xs.length || Math.max(...xs) < x0 || Math.min(...xs) > x1 || Math.max(...ys) < y0 || Math.min(...ys) > y1) continue;
        // A point inside the box, else a triangle side across it (a long upright through the box
        // with both ends outside). Each point is projected once.
        const px = new Float32Array(pos.count);
        const py = new Float32Array(pos.count);
        const front = new Uint8Array(pos.count);
        let hit = false;
        for (let k = 0; k < pos.count && !hit; k++) {
          const p = toScreen(q.fromBufferAttribute(pos, k).applyMatrix4(at));
          if (!p) continue;
          [px[k], py[k], front[k]] = [p[0], p[1], 1];
          hit = inBox(p);
        }
        const idx = g.index;
        if (!hit && idx) {
          const side = (a: number, b: number) => front[a] && front[b] && segmentMeetsRect(px[a], py[a], px[b], py[b], x0, y0, x1, y1);
          for (let t = 0; t + 2 < idx.count && !hit; t += 3) {
            const [a, b, c] = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
            hit = !!(side(a, b) || side(b, c) || side(c, a));
          }
        }
        if (hit) found.push({ m, i });
      }
    });
    if (!found.length) return;
    if (measure().filter()) return measure().box(found, drop);
    on.boxed?.()?.([...new Set(found.map((f) => meshes[f.m].keys[f.i]).filter(Boolean))], drop);
  };
  const startBox = (x: number, y: number, drop: boolean, touch: boolean) => {
    hideLabel();
    setHover(null);
    const div = document.createElement("div");
    div.className = boxLook(false);
    el.appendChild(div);
    box = { x, y, div, drop, touch };
    window.addEventListener("pointermove", onBoxMove);
    window.addEventListener("pointerup", onBoxUp);
    window.addEventListener("pointercancel", onBoxUp);
  };
  const onBoxDown = (e: PointerEvent) => {
    if (e.target !== canvas || e.button !== 0 || e.pointerType !== "mouse" || !canBox() || hitAt(e)) return;
    e.stopPropagation(); // not to the camera controls
    e.preventDefault();
    startBox(e.clientX, e.clientY, e.ctrlKey || e.metaKey, false);
    onBoxMove(e);
  };
  // A finger that was held still and now moves draws the box; its moves don't reach the camera
  // controls (which saw the press, but no movement, so they stay put).
  const onHeldMove = (e: PointerEvent) => {
    if (box?.touch) {
      e.stopPropagation();
      onBoxMove(e);
      return;
    }
    if (!held || e.pointerId !== held.id || Math.hypot(e.clientX - held.x, e.clientY - held.y) <= 8) {
      if (held && e.pointerId === held.id) e.stopPropagation();
      return;
    }
    e.stopPropagation();
    startBox(held.x, held.y, false, true);
    onBoxMove(e);
  };

  el.addEventListener("pointerdown", onBoxDown, { capture: true });
  el.addEventListener("pointermove", onHeldMove, { capture: true });
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointermove", onTouchMove);
  canvas.addEventListener("pointerleave", onLeave);
  window.addEventListener("keydown", onKey);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("dblclick", onDouble);
  canvas.addEventListener("contextmenu", onMenu);
  canvas.addEventListener("wheel", onWheel, { passive: true });

  return {
    setHover,
    dispose: () => {
      el.removeEventListener("pointerdown", onBoxDown, { capture: true });
      el.removeEventListener("pointermove", onHeldMove, { capture: true });
      window.removeEventListener("pointermove", onBoxMove);
      window.removeEventListener("pointerup", onBoxUp);
      window.removeEventListener("pointercancel", onBoxUp);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("dblclick", onDouble);
      canvas.removeEventListener("contextmenu", onMenu);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointermove", onTouchMove);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(frame);
      cancelPress();
      clearTimeout(labelTimer);
      label.remove();
      box?.div.remove();
      hoverLook.dispose();
      hoverSketch.line.dispose();
      hoverSketch.dot.dispose();
      outlineFill.dispose();
      outlineLine.dispose();
    },
  };
}

// Whether the segment a–b (screen px) meets the rectangle x0..x1 × y0..y1 (Liang–Barsky clipping).
export function segmentMeetsRect(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = bx - ax;
  const dy = by - ay;
  let lo = 0;
  let hi = 1;
  for (const [p, q] of [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dy, ay - y0],
    [dy, y1 - ay],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) lo = Math.max(lo, r);
    else hi = Math.min(hi, r);
    if (lo > hi) return false;
  }
  return true;
}
