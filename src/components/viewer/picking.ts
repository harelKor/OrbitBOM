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
// Section here.
export type MenuAt = { x: number; y: number; under: Gone | null; face: { point: V3; normal: V3 } | null };
// What the context menu acts on: the part copy under it and its part, or every picked part when
// that part is one of them; how many copies the part has, and what's hidden / isolated now.
export type MenuTarget = MenuAt & { keys: string[]; copies: number; hidden: number; isolated: { keys: string[]; ghost: boolean } | null };

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
  let hovered: { m: number; i: number } | null = null;
  const setHover = (h: { m: number; i: number } | null) => {
    if (h?.m === hovered?.m && h?.i === hovered?.i) return;
    hovered = h;
    on.hovered?.(h ? meshes[h.m].keys[h.i] : null);
    hoverLayer.clear();
    // A part hidden while measuring: its blue face / edge mark goes with it.
    if (!h) measure()?.hover(null);
    if (h) {
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
  type Hit = { m: number; i: number; tri: number; point: THREE.Vector3 };
  // `all`: every part along the ray (Select other); else the BVH stops at each mesh's nearest hit.
  const hitsAt = (e: { clientX: number; clientY: number }, all = false): Hit[] => {
    aim(e.clientX, e.clientY);
    const kept = on.kept?.() ?? null;
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
    return out;
  };
  const hitAt = (e: { clientX: number; clientY: number }) => hitsAt(e)[0] ?? null;
  const keyOf = (h: { m: number; i: number } | null | undefined) => (h ? (meshes[h.m].keys[h.i] ?? null) : null);
  // The face, edge or corner under the pointer, by the filter, on the `depth`-th part the ray
  // meets (0: the front one): corners and edges within a few pixels of it on screen (more for a
  // finger).
  const pickAt = (e: MouseEvent, finger: boolean, filter: MeasureFilter | null, depth = 0): Pick | null => {
    const h = hitsAt(e, depth > 0)[depth];
    if (!h || !filter) return null;
    const t = topo.topoOf(h.m);
    const toScreen = topo.placeOf(h.m, h.i).premultiply(root.matrixWorld);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const v = new THREE.Vector3();
    const screen = (q: V3): [number, number] => {
      v.set(q[0], q[1], q[2]).applyMatrix4(toScreen).project(stage.camera);
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
      if (!names || !key) return;
      label.textContent = names.get(key) ?? "Placed in CAD, not on the BOM";
      label.classList.remove("hidden");
      const r = el.getBoundingClientRect();
      const left = Math.min(x - r.left + 14, r.width - label.offsetWidth - 4);
      const below = y - r.top + 18;
      const top = below + label.offsetHeight > r.height ? y - r.top - label.offsetHeight - 8 : below;
      label.style.left = `${Math.max(4, left)}px`;
      label.style.top = `${Math.max(4, top)}px`;
    }, LABEL_MS);
  };

  // Long press (touch): the menu, and the lift that ends it picks nothing.
  let press: { x: number; y: number; timer: number } | null = null;
  let pressed = false;
  const touches = new Set<number>();
  const cancelPress = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };
  const menuAt = (x: number, y: number) => {
    hideLabel();
    const h = hitAt({ clientX: x, clientY: y });
    let face: MenuAt["face"] = null;
    const f = h && topo.topoOf(h.m).faces[topo.topoOf(h.m).triFace[h.tri]];
    if (h && f?.kind === "plane" && f.normal) {
      const at = topo.placeOf(h.m, h.i);
      const normal = new THREE.Vector3(...f.normal).applyMatrix3(new THREE.Matrix3().getNormalMatrix(at)).normalize();
      face = { point: root.worldToLocal(h.point.clone()).toArray() as V3, normal: normal.toArray() as V3 };
    }
    on.menu({ x, y, under: h && { m: h.m, i: h.i, key: meshes[h.m].keys[h.i] }, face });
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
  // Select other: a click again on the same spot (or Alt+click) takes the next part behind.
  let lastTap: { x: number; y: number; depth: number; pick: Pick | null } | null = null;
  const onDown = (e: PointerEvent) => {
    hideLabel();
    down = { x: e.clientX, y: e.clientY, button: e.button };
    if (e.pointerType === "mouse") return;
    touches.add(e.pointerId);
    cancelPress();
    pressed = false;
    if (touches.size === 1) {
      const { clientX: x, clientY: y } = e;
      press = {
        x,
        y,
        timer: window.setTimeout(() => {
          press = null;
          pressed = true;
          menuAt(x, y);
        }, LONG_PRESS_MS),
      };
    }
  };
  const onUp = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    cancelPress();
    const d = down;
    down = null;
    if (!d || d.button !== e.button) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX) {
      lastTap = null; // the view moved: the same screen spot shows something else now
      return;
    }
    if (e.button === 2 && e.pointerType === "mouse") return menuAt(e.clientX, e.clientY);
    if (e.button !== 0) return;
    if (pressed) {
      pressed = false;
      return;
    }
    if (on.sectionTap?.(e)) {
      lastTap = null;
      return;
    }
    const same = !!lastTap && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= CLICK_PX;
    const finger = e.pointerType !== "mouse";
    const filter = measure().filter();
    if (filter) {
      const newest = measure().newest();
      // Again on the same spot while its pick is still the newest: one part further back; past
      // the last one the pick is dropped (so with one part there it toggles off, as before).
      if (same && lastTap!.pick && newest && samePick(newest, lastTap!.pick)) {
        const depth = lastTap!.depth + 1;
        const pk = pickAt(e, finger, filter, depth);
        measure().cycle(pk);
        lastTap = pk && { x: e.clientX, y: e.clientY, depth, pick: pk };
        return;
      }
      const depth = e.altKey ? 1 : 0;
      const pk = pickAt(e, finger, filter, depth);
      measure().tap(pk);
      const now = measure().newest();
      lastTap = pk && now && samePick(now, pk) ? { x: e.clientX, y: e.clientY, depth, pick: pk } : null;
      return;
    }
    // Plain part picking (no measuring): Alt+click steps back through the parts there.
    const hits = hitsAt(e, e.altKey);
    const depth = e.altKey ? (same ? lastTap!.depth + 1 : 1) % Math.max(1, hits.length) : 0;
    lastTap = { x: e.clientX, y: e.clientY, depth, pick: null };
    on.pick(keyOf(hits[depth]));
  };
  const onCancel = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    cancelPress();
    down = null;
  };
  const onDouble = (e: MouseEvent) => {
    const open = on.open();
    if (e.button !== 0 || !open || measure().filter()) return;
    const key = keyOf(hitAt(e));
    if (key) open(key);
  };
  const onMenu = (e: MouseEvent) => e.preventDefault(); // ours opens on pointerup (or a long press)
  const onWheel = () => {
    hideLabel();
    lastTap = null;
  };

  // Box select: Shift+left-drag from empty space picks every part copy wholly inside the box
  // (while picking faces, as on the CAD page). Caught before the camera controls, which would pan.
  let box: { x: number; y: number; div: HTMLDivElement } | null = null;
  const boxRect = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    const x0 = Math.min(box!.x, e.clientX) - r.left;
    const y0 = Math.min(box!.y, e.clientY) - r.top;
    return { x0, y0, x1: x0 + Math.abs(e.clientX - box!.x), y1: y0 + Math.abs(e.clientY - box!.y) };
  };
  const onBoxMove = (e: PointerEvent) => {
    if (!box) return;
    const { x0, y0, x1, y1 } = boxRect(e);
    Object.assign(box.div.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
  };
  const onBoxUp = (e: PointerEvent) => {
    if (!box) return;
    const { x0, y0, x1, y1 } = boxRect(e);
    box.div.remove();
    box = null;
    window.removeEventListener("pointermove", onBoxMove);
    window.removeEventListener("pointerup", onBoxUp);
    if (x1 - x0 < CLICK_PX && y1 - y0 < CLICK_PX) return;
    const r = canvas.getBoundingClientRect();
    const inside: { m: number; i: number }[] = [];
    const at = new THREE.Matrix4();
    const corner = new THREE.Vector3();
    meshes.forEach(({ mesh }, m) => {
      if (!mesh.visible) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const { min, max } = mesh.geometry.boundingBox!;
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, at);
        if (Math.abs(at.determinant()) < 1e-12) continue; // hidden (drawn at no size)
        at.premultiply(mesh.matrixWorld);
        let all = true;
        for (let c = 0; c < 8 && all; c++) {
          corner.set(c & 1 ? max.x : min.x, c & 2 ? max.y : min.y, c & 4 ? max.z : min.z).applyMatrix4(at).project(stage.camera);
          const sx = ((corner.x + 1) / 2) * r.width;
          const sy = ((1 - corner.y) / 2) * r.height;
          all = corner.z < 1 && sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
        }
        if (all) inside.push({ m, i });
      }
    });
    if (inside.length) measure().box(inside);
  };
  const onBoxDown = (e: PointerEvent) => {
    if (e.target !== canvas || e.button !== 0 || !e.shiftKey || e.pointerType !== "mouse" || !measure().filter() || hitAt(e)) return;
    e.stopPropagation(); // not to the camera controls
    e.preventDefault();
    hideLabel();
    const div = document.createElement("div");
    div.className = "pointer-events-none absolute z-20 border border-dashed border-accent bg-accent/10";
    el.appendChild(div);
    box = { x: e.clientX, y: e.clientY, div };
    onBoxMove(e);
    window.addEventListener("pointermove", onBoxMove);
    window.addEventListener("pointerup", onBoxUp);
  };

  el.addEventListener("pointerdown", onBoxDown, { capture: true });
  canvas.addEventListener("pointermove", onMove);
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
      window.removeEventListener("pointermove", onBoxMove);
      window.removeEventListener("pointerup", onBoxUp);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("dblclick", onDouble);
      canvas.removeEventListener("contextmenu", onMenu);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(frame);
      cancelPress();
      clearTimeout(labelTimer);
      label.remove();
      box?.div.remove();
      hoverLook.dispose();
      outlineFill.dispose();
      outlineLine.dispose();
    },
  };
}
