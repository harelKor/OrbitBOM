// Moving parts in the view (S7 in plan/cad-3d-viewer.md), like Onshape's assembly view: the
// exploded view (a slider spreads the subsystems out from the robot's centre, then the parts within
// each from its own centre) and Move, a triad on the picked parts to slide or turn them. Only the
// view changes: nothing is saved or sent to Onshape. Parts move by their instance matrices, so
// picking, Measure, Section and Hide all work on the moved places; the originals are kept for
// Reset. Motion along the mates (S8) comes later, here too.
import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { createKinematics, type Dof, type Kinematics } from "@/lib/model/kinematics";
import { turns } from "@/lib/model/mates";
import type { Stage } from "./stage";
import type { PartMesh, ViewerModel } from "./types";

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
  moveParts: (target: Copy | Copy[] | string[], only?: boolean) => void; // the triad on copies (with their rigid sets, unless `only`), or every shown copy of these parts
  moveMode: (mode: MoveMode) => void;
  moveDone: () => void; // the triad away, the parts stay where they are
  resetPositions: () => void; // everything back to its CAD place, explode at 0
  motionNow: () => MotionView;
  // The mates (plan/cad-mates.md): the copies moving with a copy (its rigid set), and where the
  // mates are moved to (saved views).
  groupOf: (c: Copy) => Copy[];
  matesNow: () => Record<string, [number, number]>;
  setMates: (v: Record<string, [number, number]>) => void;
  onMotion: (cb: (v: MotionView) => void) => () => void;
};

export type Motion = { tools: MotionTools; dispose: () => void };

export function createMotion(
  stage: Stage,
  meshes: PartMesh[],
  model: Pick<ViewerModel, "placements" | "joints" | "relations" | "fixed">,
  controls: { enabled: boolean }, // the camera's, off while the triad drags
  on: {
    // A copy's place (its kept place while hidden with Y) and putting it somewhere (visibility.ts).
    place: (m: number, i: number, out: THREE.Matrix4) => THREE.Matrix4;
    setPlace: (m: number, i: number, at: THREE.Matrix4) => void;
    shown: (m: number, i: number) => boolean;
    moved: () => void; // matrices changed: redraw the selection
    settled: () => void; // a drag or the slider let go: redo the slower things (section outlines)
    fingerDrags?: () => boolean; // the phone's rotation lock is on: one finger drags parts too
  },
): Motion {
  // Per copy touched: its CAD place, the Move on top of it, and its explode offset.
  type Entry = { m: number; i: number; at: THREE.Matrix4; move: THREE.Matrix4; joint: THREE.Matrix4; off: THREE.Vector3 };
  const orig = new Map<string, Entry>();
  // The mates: a tree of rigid bodies from each piece's first one (kinematics.ts).
  const joints = model.joints ?? [];
  const kin: Kinematics | null = joints.length ? createKinematics(joints, model.relations ?? [], new Set(model.fixed ?? [])) : null;
  const bodyOf = (c: Copy) => meshes[c.m]?.bodies?.[c.i] ?? -1;

  let t = 0;
  let panel = false;
  let mode: MoveMode = "slide";
  let moving: Copy[] = [];
  const listeners = new Set<(v: MotionView) => void>();
  const view = (): MotionView => ({
    explode: t,
    panel,
    moving: moving.length ? { count: moving.length, mode } : null,
    moved: t > 0 || !!kin?.moved() || [...orig.values()].some((o) => !isIdentity(o.move)),
  });
  const tell = () => {
    const v = view();
    listeners.forEach((cb) => cb(v));
  };
  const entry = (m: number, i: number) => {
    const id = `${m}:${i}`;
    let o = orig.get(id);
    if (!o) orig.set(id, (o = { m, i, at: on.place(m, i, new THREE.Matrix4()), move: new THREE.Matrix4(), joint: new THREE.Matrix4(), off: new THREE.Vector3() }));
    return o;
  };
  const tmp = new THREE.Matrix4();
  // Explode offset · free Move · the mates' move · the CAD place.
  const write = (o: Entry) => {
    tmp.makeTranslation(o.off).multiply(o.move).multiply(o.joint).multiply(o.at);
    on.setPlace(o.m, o.i, tmp);
  };
  // The copies of the bodies the mates moved, put where they are now.
  const applyBodies = (changed: Set<number>) => {
    if (!kin || !changed.size) return;
    const moves = kin.moves();
    meshes.forEach(({ bodies }, m) => {
      if (!bodies) return;
      bodies.forEach((b, i) => {
        if (b < 0 || !changed.has(b)) return;
        const o = entry(m, i);
        o.joint.copy(moves.get(b) ?? ID);
        write(o);
        dirty.add(m);
      });
    });
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
    meshes.forEach(({ mesh, sketch }, m) => {
      if (sketch) return; // Geometry sketches stay where the design is (their lines aren't instanced)
      for (let i = 0; i < mesh.count; i++) all.push(entry(m, i));
    });
    // A rigid set (mates.ts) spreads as one piece: its copies share their centre.
    const centres = all.map((o) => centreOf(o.m, tmp.multiplyMatrices(o.move, o.joint).multiply(o.at)));
    const sum = new Map<number, { c: THREE.Vector3; n: number }>();
    all.forEach((o, k) => {
      const b = bodyOf(o);
      if (b < 0) return;
      const x = sum.get(b) ?? { c: new THREE.Vector3(), n: 0 };
      x.c.add(centres[k]);
      x.n++;
      sum.set(b, x);
    });
    const offs = explodeOffsets(
      all.map((o, k) => {
        const x = sum.get(bodyOf(o));
        return { g: meshes[o.m].g, c: (x ? x.c.clone().divideScalar(x.n) : centres[k]).toArray() as V3 };
      }),
      t,
    );
    all.forEach((o, k) => {
      o.off.fromArray(offs[k]);
      write(o);
      dirty.add(o.m);
    });
    // Back at 0 with nothing moved: the CAD places, exactly.
    if (t === 0) for (const [id, o] of orig) if (isIdentity(o.move) && isIdentity(o.joint)) orig.delete(id);
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
  const drive = (j: number, dof: Dof, v: number) => {
    if (!kin) return;
    applyBodies(kin.set(j, dof, v));
    flush();
  };
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

  // A rigid set: every shown copy of the same body.
  const groupOf = (c: Copy): Copy[] => {
    const b = bodyOf(c);
    if (b < 0) return [c];
    const out: Copy[] = [];
    meshes.forEach(({ bodies, sketch }, m) => !sketch && bodies?.forEach((x, i) => x === b && on.shown(m, i) && out.push({ m, i })));
    return out.length ? out : [c];
  };

  const moveParts = (target: Copy | Copy[] | string[], only = false) => {
    moving = [];
    if (Array.isArray(target) && target.length && typeof target[0] !== "string") moving = (target as Copy[]).filter((c) => on.shown(c.m, c.i));
    else if (Array.isArray(target)) {
      const want = new Set(target as string[]);
      meshes.forEach(({ keys, sketch }, m) => !sketch && keys.forEach((k, i) => want.has(k) && on.shown(m, i) && moving.push({ m, i })));
    } else moving = [target];
    // Onshape moves what's grouped or fastened together: the whole rigid set, unless only the part.
    if (!only) {
      const seen = new Set(moving.map((c) => `${c.m}:${c.i}`));
      for (const c of [...moving])
        for (const x of groupOf(c)) {
          if (seen.has(`${x.m}:${x.i}`)) continue;
          seen.add(`${x.m}:${x.i}`);
          moving.push(x);
        }
    }
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
    kin?.reset();
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
  // Onshape's drag: a left drag on a part with a mate moves it along that mate (a turn follows
  // the pointer round the axis; a slide along it). A press that doesn't move is still a click.
  // On a phone with the rotation lock on, one finger does the same (Harel, 2026-11-19): the
  // finger's events still go on to picking and the camera (the lock keeps the camera still), so
  // their own touch bookkeeping stays right; a finger held still first is a long press instead
  // (picking's menu or box select), not a drag.
  const ray = new THREE.Raycaster();
  const toModel = () => stage.root.matrixWorld.clone().invert();
  const screen = (p: THREE.Vector3) => {
    const r = canvas.getBoundingClientRect();
    const v = p.clone().applyMatrix4(stage.root.matrixWorld).project(stage.camera);
    return new THREE.Vector2(((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height);
  };
  const rayAt = (x: number, y: number) => {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), stage.camera);
    return ray;
  };
  let press: { x: number; y: number; id: number; j: number; p0: THREE.Vector3; value: number; going: boolean; finger: boolean; t: number } | null = null;
  const onPress = (e: PointerEvent) => {
    const finger = e.pointerType === "touch";
    // A second finger: a pinch, not a drag (unless the part is already moving).
    if (finger && press) {
      if (!press.going) press = null;
      return;
    }
    if (finger ? !on.fingerDrags?.() : e.pointerType !== "mouse") return;
    // Not while Move's triad is up: Move moves the parts freely (Harel, 2026-11-18).
    if (!kin || moving.length || e.button !== 0 || e.target !== canvas || dragId !== null) return;
    const hit = rayAt(e.clientX, e.clientY).intersectObjects(meshes.filter((x) => x.mesh.visible && x.bodies).map((x) => x.mesh), false)[0];
    if (!hit || hit.instanceId === undefined) return;
    const m = meshes.findIndex((x) => x.mesh === hit.object);
    const j = kin.driver(bodyOf({ m, i: hit.instanceId }));
    if (j === null) return;
    press = { x: e.clientX, y: e.clientY, id: e.pointerId, j, p0: hit.point.clone().applyMatrix4(toModel()), value: kin.value(j)[turns(joints[j].type) ? "turn" : "slide"], going: false, finger, t: performance.now() };
  };
  const onPressMove = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id || !kin) return;
    if (!press.going) {
      if (press.finger && performance.now() - press.t > HOLD_MS) return void (press = null);
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= (press.finger ? 8 : 4)) return;
      press.going = true;
      controls.enabled = false;
    }
    if (!press.finger) e.stopPropagation();
    const { j, p0 } = press;
    const f = kin.frame(j);
    const o = new THREE.Vector3().setFromMatrixPosition(f);
    const z = new THREE.Vector3().setFromMatrixColumn(f, 2).normalize();
    const dof: Dof = turns(joints[j].type) ? "turn" : "slide";
    const d = kin.dir(j);
    const delta = new THREE.Vector2(e.clientX - press.x, e.clientY - press.y);
    let by = 0;
    if (dof === "turn") {
      const u = p0.clone().sub(o).projectOnPlane(z);
      const radius = u.length();
      const pr = rayAt(e.clientX, e.clientY).ray.clone().applyMatrix4(toModel());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(z, p0);
      const hit = Math.abs(pr.direction.dot(z)) > 0.25 ? pr.intersectPlane(plane, new THREE.Vector3()) : null;
      if (hit && radius > 1e-4) {
        const v = hit.sub(o).projectOnPlane(z);
        by = Math.atan2(z.dot(u.clone().cross(v)), u.dot(v));
      } else if (radius > 1e-4) {
        // Seen edge on: the pointer along the turn's way on screen, over the radius.
        const tang = z.clone().cross(u).normalize().multiplyScalar(radius * 0.01);
        const s0 = screen(p0);
        const step = screen(p0.clone().add(tang)).sub(s0);
        if (step.length() > 0.01) by = (delta.dot(step.clone().normalize()) / step.length()) * 0.01;
      }
    } else {
      const axis = joints[j].type === "pinSlot" ? new THREE.Vector3().setFromMatrixColumn(f, 0).normalize() : z;
      const s0 = screen(p0);
      const step = screen(p0.clone().add(axis.clone().multiplyScalar(0.01))).sub(s0); // px per cm
      if (step.length() > 0.2) by = (delta.dot(step.clone().normalize()) / step.length()) * 0.01;
    }
    drive(j, dof, press.value + d * by);
    tell();
  };
  const onPressUp = (e: PointerEvent) => {
    if (!press || e.pointerId !== press.id) return;
    const { going: went, finger } = press;
    press = null;
    if (!went) return;
    if (!finger) e.stopPropagation();
    controls.enabled = true;
    on.settled();
    tell();
  };

  const el = stage.el;
  el.addEventListener("pointerdown", onPress, true);
  window.addEventListener("pointermove", onPressMove, true);
  window.addEventListener("pointerup", onPressUp, true);
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
      groupOf,
      matesNow: () => kin?.values() ?? {},
      setMates: (v) => {
        if (!kin) return;
        applyBodies(kin.restore(v));
        flush();
        on.settled();
        tell();
      },
      onMotion: (cb) => {
        listeners.add(cb);
        return () => {
          listeners.delete(cb);
        };
      },
    },
    dispose: () => {
      el.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("pointermove", onPressMove, true);
      window.removeEventListener("pointerup", onPressUp, true);
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

// A finger held this long before moving is picking's long press (its LONG_PRESS_MS is 500).
const HOLD_MS = 450;
const ID = new THREE.Matrix4();
const isIdentity = (m: THREE.Matrix4) => m.elements.every((v, k) => Math.abs(v - ID.elements[k]) < 1e-12);
