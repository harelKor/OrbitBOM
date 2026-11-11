// Moving parts in the view (S7 in plan/cad-3d-viewer.md), like Onshape's assembly view: the
// exploded view (a slider spreads the subsystems out from the robot's centre, then the parts within
// each from its own centre) and Move, a triad on the picked parts to slide or turn them. Only the
// view changes: nothing is saved or sent to Onshape. Parts move by their instance matrices, so
// picking, Measure, Section and Hide all work on the moved places; the originals are kept for
// Reset. Motion along the mates (S8) comes later, here too.
import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Stage } from "./stage";
import type { PartMesh } from "./types";

type V3 = [number, number, number];

// How far the slider's end spreads things, as a multiple of their distance from the centre:
// subsystems first (the slider's first half), then the parts within each (its second half).
const SPREAD_GROUPS = 1;
const SPREAD_PARTS = 1.2;

// Each copy's offset (model frame, metres) at slider position t (0…1), from its subsystem `g` and
// its centre `c`. With one subsystem the whole slider spreads its parts.
export function explodeOffsets(items: { g: number; c: V3 }[], t: number): V3[] {
  const k = Math.min(1, Math.max(0, t));
  if (!items.length || k === 0) return items.map(() => [0, 0, 0]);
  const mid = (cs: V3[]): V3 => {
    const lo: V3 = [Infinity, Infinity, Infinity];
    const hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const c of cs)
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], c[a]);
        hi[a] = Math.max(hi[a], c[a]);
      }
    return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  };
  const byGroup = new Map<number, V3[]>();
  for (const { g, c } of items) byGroup.set(g, [...(byGroup.get(g) ?? []), c]);
  const centres = new Map([...byGroup].map(([g, cs]) => [g, mid(cs)]));
  const robot = mid([...centres.values()]);
  const many = centres.size > 1;
  const sg = many ? Math.min(1, 2 * k) * SPREAD_GROUPS : 0;
  const sp = (many ? Math.max(0, 2 * k - 1) : k) * SPREAD_PARTS;
  return items.map(({ g, c }) => {
    const gc = centres.get(g)!;
    return [0, 1, 2].map((a) => (gc[a] - robot[a]) * sg + (c[a] - gc[a]) * sp) as V3;
  });
}

export type MoveMode = "slide" | "turn";
// What the panels show: the explode slider (its panel open or not), Move on some copies, and
// whether anything sits away from its CAD place (the "Moved (not in CAD)" chip).
export type MotionView = { explode: number; panel: boolean; moving: { count: number; mode: MoveMode } | null; moved: boolean };
export type Copy = { m: number; i: number };

export type MotionTools = {
  explodeShow: (open: boolean) => void; // the Exploded view panel
  explode: (t: number, settled?: boolean) => void; // the slider, 0…1; settled: let go (redo the slow parts)
  moveParts: (target: Copy | string[]) => void; // the triad on one copy, or every shown copy of these parts
  moveMode: (mode: MoveMode) => void;
  moveDone: () => void; // the triad away, the parts stay where they are
  resetPositions: () => void; // everything back to its CAD place, explode at 0
  motionNow: () => MotionView;
  onMotion: (cb: (v: MotionView) => void) => () => void;
};

export type Motion = { tools: MotionTools; dispose: () => void };

export function createMotion(
  stage: Stage,
  meshes: PartMesh[],
  controls: { enabled: boolean }, // the camera's, off while the triad drags
  on: {
    // A copy's place (its kept place while hidden with Y) and putting it somewhere (visibility.ts).
    place: (m: number, i: number, out: THREE.Matrix4) => THREE.Matrix4;
    setPlace: (m: number, i: number, at: THREE.Matrix4) => void;
    shown: (m: number, i: number) => boolean;
    moved: () => void; // matrices changed: redraw the selection
    settled: () => void; // a drag or the slider let go: redo the slower things (section outlines)
  },
): Motion {
  // Per copy touched: its CAD place, the Move on top of it, and its explode offset.
  const orig = new Map<string, { m: number; i: number; at: THREE.Matrix4; move: THREE.Matrix4; off: THREE.Vector3 }>();
  let t = 0;
  let panel = false;
  let mode: MoveMode = "slide";
  let moving: Copy[] = [];
  const listeners = new Set<(v: MotionView) => void>();
  const view = (): MotionView => ({
    explode: t,
    panel,
    moving: moving.length ? { count: moving.length, mode } : null,
    moved: t > 0 || [...orig.values()].some((o) => !isIdentity(o.move)),
  });
  const tell = () => {
    const v = view();
    listeners.forEach((cb) => cb(v));
  };
  const entry = (m: number, i: number) => {
    const id = `${m}:${i}`;
    let o = orig.get(id);
    if (!o) orig.set(id, (o = { m, i, at: on.place(m, i, new THREE.Matrix4()), move: new THREE.Matrix4(), off: new THREE.Vector3() }));
    return o;
  };
  const tmp = new THREE.Matrix4();
  const write = (o: { m: number; i: number; at: THREE.Matrix4; move: THREE.Matrix4; off: THREE.Vector3 }) => {
    tmp.makeTranslation(o.off).multiply(o.move).multiply(o.at);
    on.setPlace(o.m, o.i, tmp);
  };
  const dirty = new Set<number>();
  const flush = () => {
    for (const m of dirty) {
      const { mesh } = meshes[m];
      mesh.instanceMatrix.needsUpdate = true;
      // Rays and framing test these first.
      mesh.computeBoundingSphere();
      mesh.computeBoundingBox();
      const lines = mesh.children[0] as THREE.LineSegments | undefined;
      if (lines?.geometry && mesh.boundingBox) lines.geometry.boundingBox = mesh.boundingBox.clone();
    }
    dirty.clear();
    on.moved();
    stage.render();
  };

  // Explode: every copy's centre at its CAD place (with its own Move), spread by the maths above.
  const centreOf = (m: number, at: THREE.Matrix4) => {
    const g = meshes[m].mesh.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(at);
  };
  const explode = (to: number, settled = false) => {
    t = Math.min(1, Math.max(0, to));
    const all: ReturnType<typeof entry>[] = [];
    meshes.forEach(({ mesh }, m) => {
      for (let i = 0; i < mesh.count; i++) all.push(entry(m, i));
    });
    const offs = explodeOffsets(
      all.map((o) => ({ g: meshes[o.m].g, c: centreOf(o.m, tmp.multiplyMatrices(o.move, o.at)).toArray() as V3 })),
      t,
    );
    all.forEach((o, k) => {
      o.off.fromArray(offs[k]);
      write(o);
      dirty.add(o.m);
    });
    // Back at 0 with nothing moved: the CAD places, exactly.
    if (t === 0) for (const [id, o] of orig) if (isIdentity(o.move)) orig.delete(id);
    if (gizmo.object) placePivot();
    flush();
    if (settled) on.settled();
    tell();
  };

  // Move: three's TransformControls (Onshape's triad: arrows to slide along an axis, rings to turn
  // about one), on a pivot at the moving copies' centre, its axes the model's X, Y, Z. It's driven
  // from this file's own pointer handlers (no element given), so a press on it never reaches the
  // camera or picking.
  const pivot = new THREE.Object3D();
  stage.root.add(pivot);
  const gizmo = new TransformControls(stage.camera);
  gizmo.setSpace("local");
  gizmo.setSize(0.9);
  const helper = gizmo.getHelper();
  stage.world.add(helper);
  gizmo.addEventListener("change", () => stage.render());
  const placePivot = () => {
    const box = new THREE.Box3();
    const at = new THREE.Matrix4();
    const g = new THREE.Box3();
    for (const { m, i } of moving) {
      const geo = meshes[m].mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      box.union(g.copy(geo.boundingBox!).applyMatrix4(on.place(m, i, at)));
    }
    pivot.position.copy(box.getCenter(new THREE.Vector3()));
    pivot.quaternion.identity();
    pivot.updateMatrix();
  };
  let start: { pivot: THREE.Matrix4; move: Map<string, THREE.Matrix4> } | null = null;
  gizmo.addEventListener("mouseDown", () => {
    pivot.updateMatrix();
    start = { pivot: pivot.matrix.clone(), move: new Map(moving.map(({ m, i }) => [`${m}:${i}`, entry(m, i).move.clone()])) };
  });
  gizmo.addEventListener("objectChange", () => {
    if (!start) return;
    pivot.updateMatrix();
    // The pivot's change since the press, in the model frame; each copy's Move gets it, under
    // its explode offset (the offset stays a plain slide out).
    const d = pivot.matrix.clone().multiply(start.pivot.clone().invert());
    const inv = new THREE.Matrix4();
    const shift = new THREE.Matrix4();
    for (const { m, i } of moving) {
      const o = entry(m, i);
      shift.makeTranslation(o.off);
      inv.copy(shift).invert();
      o.move.copy(inv).multiply(d).multiply(shift).multiply(start.move.get(`${m}:${i}`)!);
      write(o);
      dirty.add(m);
    }
    flush();
  });
  gizmo.addEventListener("mouseUp", () => {
    start = null;
    on.settled();
    tell();
  });

  const moveParts = (target: Copy | string[]) => {
    moving = [];
    if (Array.isArray(target)) {
      const want = new Set(target);
      meshes.forEach(({ keys }, m) => keys.forEach((k, i) => want.has(k) && on.shown(m, i) && moving.push({ m, i })));
    } else moving = [target];
    if (!moving.length) return;
    placePivot();
    gizmo.setMode(mode === "slide" ? "translate" : "rotate");
    gizmo.attach(pivot);
    stage.render();
    tell();
  };
  const moveDone = () => {
    if (!moving.length) return;
    moving = [];
    gizmo.detach();
    stage.render();
    tell();
  };
  const moveMode = (m: MoveMode) => {
    mode = m;
    gizmo.setMode(m === "slide" ? "translate" : "rotate");
    stage.render();
    tell();
  };
  const resetPositions = () => {
    t = 0;
    for (const o of orig.values()) {
      on.setPlace(o.m, o.i, o.at);
      dirty.add(o.m);
    }
    orig.clear();
    if (gizmo.object) placePivot();
    flush();
    on.settled();
    tell();
  };

  // The triad's pointer handling, on the view's element in the capture phase like the section
  // handle: only presses on the triad are taken; everything else goes on to the camera and picking.
  const canvas = stage.renderer.domElement;
  const pointer = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    // TransformControls takes this { x, y, button } (NDC) though its types say PointerEvent.
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1, button: e.button } as unknown as PointerEvent;
  };
  let dragId: number | null = null;
  const onDown = (e: PointerEvent) => {
    if (!gizmo.object || e.button !== 0 || e.target !== canvas) return;
    helper.updateMatrixWorld(true);
    gizmo.pointerHover(pointer(e)); // a finger has no hover: test where it lands
    if (gizmo.axis === null) return;
    e.stopPropagation();
    e.preventDefault();
    dragId = e.pointerId;
    controls.enabled = false;
    gizmo.pointerDown(pointer(e));
  };
  let lastAxis: string | null = null;
  const onMove = (e: PointerEvent) => {
    if (!gizmo.object) return;
    if (dragId !== null) {
      if (e.pointerId !== dragId) return;
      e.stopPropagation();
      gizmo.pointerMove(pointer(e));
      return;
    }
    if (e.pointerType !== "mouse" || e.target !== canvas) return;
    gizmo.pointerHover(pointer(e));
    if (gizmo.axis !== lastAxis) {
      lastAxis = gizmo.axis;
      stage.render(); // the axis under the mouse lights up
    }
  };
  const onUp = (e: PointerEvent) => {
    if (dragId === null || e.pointerId !== dragId) return;
    e.stopPropagation();
    dragId = null;
    controls.enabled = true;
    gizmo.pointerUp(pointer(e));
  };
  // Esc puts the triad away (Onshape's ✓); the parts stay moved.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !moving.length || e.defaultPrevented) return;
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    moveDone();
  };
  const el = stage.el;
  el.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
  window.addEventListener("keydown", onKey, true);

  return {
    tools: {
      explodeShow: (open) => {
        panel = open;
        tell();
      },
      explode,
      moveParts,
      moveMode,
      moveDone,
      resetPositions,
      motionNow: view,
      onMotion: (cb) => {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
    },
    dispose: () => {
      el.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("keydown", onKey, true);
      listeners.clear();
      gizmo.detach();
      stage.world.remove(helper);
      // Not gizmo.dispose(): it unhooks an element it never had and throws.
      helper.traverse((o) => {
        const x = o as THREE.Mesh;
        x.geometry?.dispose();
        (Array.isArray(x.material) ? x.material : x.material ? [x.material] : []).forEach((mt) => mt.dispose());
      });
      stage.root.remove(pivot);
    },
  };
}

const ID = new THREE.Matrix4();
const isIdentity = (m: THREE.Matrix4) => m.elements.every((v, k) => Math.abs(v - ID.elements[k]) < 1e-12);
