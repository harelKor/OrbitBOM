// Camera controls, Fit, the standard views and the view cube's API, made to feel like Onshape
// (plan/cad-3d-viewer.md S1): the wheel and a pinch zoom at the pointer, a drag rotates about the
// point it starts on, orthographic by default, animated view changes and Onshape's view keys.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Stage } from "./stage";
import type { PartMesh } from "./types";

// "side" is the old name of "right" (kept for callers that still use it).
export type ViewName = "front" | "back" | "left" | "right" | "top" | "bottom" | "iso" | "dimetric" | "side";
// Directions from the model to the camera, in the scene's Y-up frame (Onshape's Z is up: the
// model's front, -Y, is the scene's +Z).
export const VIEWS: Record<ViewName, [number, number, number]> = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  side: [1, 0, 0],
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  iso: [1, 1, 1],
  dimetric: [1, 1, 2],
};

export type Projection = "ortho" | "perspective";
// The camera as plain numbers (scene frame), for saved views: where it looks, the direction from
// there to the camera, and half the view's height at that point in metres.
export type ViewPose = { target: [number, number, number]; dir: [number, number, number]; half: number; projection: Projection };

export type CameraTools = {
  view: (name: ViewName | "fit") => void; // animated, framed on what's shown
  look: (dir: [number, number, number]) => void; // from a direction (scene frame), framed on what's shown: the view cube
  orbit: (right: number, up: number) => void; // turn the view about its centre, in degrees (camera moves right / up)
  frameBox: (box: THREE.Box3) => void; // frame a box (world space) from the current direction, animated
  projection: () => Projection;
  setProjection: (p: Projection) => void;
  pose: () => ViewPose;
  setPose: (pose: ViewPose, animate?: boolean) => void;
  watch: (turned: (q: THREE.Quaternion) => void) => () => void; // the camera's orientation, on every change (the view cube)
  onShortcuts: (open: (() => void) | null) => void; // the `?` key
};
export type Camera = {
  controls: OrbitControls;
  // Frames a box (world space) at once; `minRadius` keeps a tiny part from filling the screen.
  fit: (box: THREE.Box3, minRadius?: number) => void;
  tools: CameraTools;
  dispose: () => void;
};

const UP = new THREE.Vector3(0, 1, 0);
const BACK = new THREE.Vector3(0, 0, 1); // the camera's own +Z: from what it looks at towards it
const POLE = 1e-3; // radians kept off straight up / down, where "up" on screen is undefined
const STORE = "orbitparts.viewer.projection";

// Where the camera goes to frame `box` from direction `dir` (target → camera), so the box's
// bounding sphere fits the field of view (the narrower of the two on a tall phone screen). Null
// for an empty box. `radius` is the sphere's, for an orthographic view's height.
export function fitPose(
  box: THREE.Box3,
  dir: THREE.Vector3,
  fovDeg: number,
  minRadius = 0.02,
  aspect = 1,
): { target: THREE.Vector3; position: THREE.Vector3; radius: number } | null {
  if (box.isEmpty()) return null;
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, minRadius);
  const d = dir.clone().normalize();
  if (!d.lengthSq()) d.set(1, 0.7, 1).normalize();
  const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(fovDeg / 2)) * Math.min(1, aspect));
  return { target: center, position: center.clone().addScaledVector(d, radius / Math.sin(half)), radius };
}

// `dir` turned about the vertical by `right` degrees (the camera moving right) and tilted `up`
// degrees (the camera moving up), never past straight up or down.
export function orbitDir(dir: THREE.Vector3, right: number, up: number): THREE.Vector3 {
  const s = new THREE.Spherical().setFromVector3(dir);
  s.theta += THREE.MathUtils.degToRad(right);
  s.phi = THREE.MathUtils.clamp(s.phi - THREE.MathUtils.degToRad(up), POLE, Math.PI - POLE);
  return new THREE.Vector3().setFromSpherical(s).normalize();
}

// The camera's orientation looking along -dir with the scene's up on top (a hair off the poles).
export function lookFrom(dir: THREE.Vector3): THREE.Quaternion {
  const d = dir.clone().normalize();
  if (1 - Math.abs(d.y) < 1e-6) d.set(0, Math.sign(d.y), 1e-3).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(d, new THREE.Vector3(), UP));
}

// The view cube's CSS transform for a camera orientation: the scene turned into the camera's frame,
// with CSS's Y (down) flipped.
export function cubeMatrix(q: THREE.Quaternion): string {
  const e = new THREE.Matrix4().makeRotationFromQuaternion(q.clone().invert()).elements;
  const s = [1, -1, 1, 1];
  return `matrix3d(${e.map((v, i) => +(v * s[i % 4] * s[Math.floor(i / 4)]).toFixed(6) || 0).join(",")})`;
}

// Onshape's view keys, by key position (e.code) so a Hebrew layout works too.
export type KeyCommand = { kind: "fit" } | { kind: "view"; name: ViewName } | { kind: "orbit"; right: number; up: number } | { kind: "help" } | null;
const SHIFT_VIEWS: ViewName[] = ["front", "back", "left", "right", "top", "bottom", "iso"];
export function keyCommand(e: { code: string; key?: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): KeyCommand {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.code === "KeyF" && !e.shiftKey) return { kind: "fit" };
  const digit = /^Digit([1-7])$/.exec(e.code);
  if (digit && e.shiftKey) return { kind: "view", name: SHIFT_VIEWS[Number(digit[1]) - 1] };
  const step = e.shiftKey ? 90 : 15;
  if (e.code === "ArrowLeft") return { kind: "orbit", right: -step, up: 0 };
  if (e.code === "ArrowRight") return { kind: "orbit", right: step, up: 0 };
  if (e.code === "ArrowUp") return { kind: "orbit", right: 0, up: step };
  if (e.code === "ArrowDown") return { kind: "orbit", right: 0, up: -step };
  if ((e.code === "Slash" && e.shiftKey) || e.key === "?") return { kind: "help" };
  return null;
}

// The near and far planes around the model's sphere (centre at depth `d` in front of the camera,
// radius `r`): as tight as the model allows, and close up never nearer than a fiftieth of the way
// to the point being looked at, so zooming in doesn't cut the part away nor wreck the depth test.
export function clipPlanes(d: number, r: number, toTarget: number, ortho: boolean): { near: number; far: number } {
  const far = Math.max(d + r * 1.05, 1e-3);
  const near = ortho ? Math.max(d - r * 1.05, far * 1e-4) : Math.max(d - r * 1.05, toTarget * 0.02, far * 1e-6);
  return { near: Math.min(near, far * 0.99), far };
}

type Pose = { target: THREE.Vector3; quat: THREE.Quaternion; half: number };

// Onshape-like: right drag rotates (left drag too, for touchpads), about the point under the
// pointer when the drag starts on the model; middle drag moves; the wheel zooms at the pointer.
// One finger rotates, two pinch (at their centre) and move. `shown` is the box of what's drawn now,
// for Fit and the views.
export function createCamera(stage: Stage, shown: () => THREE.Box3, meshes: PartMesh[]): Camera {
  const { camera, renderer, render, el } = stage;
  const canvas = renderer.domElement;
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.zoomToCursor = true;
  // Rotating is done here (below), about the point under the pointer; OrbitControls pans and zooms.
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
  controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN };
  // A middle click on a link-free canvas still starts the browser's auto-scroll; stop it.
  const noAutoScroll = (e: MouseEvent) => e.button === 1 && e.preventDefault();
  canvas.addEventListener("mousedown", noAutoScroll);

  const tanV = () => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const watchers = new Set<(q: THREE.Quaternion) => void>();
  const moved = () => {
    for (const w of watchers) w(camera.quaternion);
    render();
  };
  controls.addEventListener("change", moved);

  // Near / far follow the model (what's drawn), every frame. In ortho the camera also stays
  // outside the model (it doesn't change the picture there), so rays for picking start in front.
  const sphere = new THREE.Sphere();
  const box = new THREE.Box3();
  const part = new THREE.Box3();
  const fwd = new THREE.Vector3();
  const clip = () => {
    box.makeEmpty();
    for (const { mesh } of meshes) {
      if (!mesh.visible) continue;
      if (!mesh.boundingBox) mesh.computeBoundingBox();
      box.union(part.copy(mesh.boundingBox!).applyMatrix4(mesh.matrixWorld));
    }
    if (box.isEmpty()) return;
    box.getBoundingSphere(sphere);
    camera.getWorldDirection(fwd);
    let d = sphere.center.clone().sub(camera.position).dot(fwd);
    if (camera.ortho && d < sphere.radius * 1.1) {
      const back = sphere.radius * 1.2 - d;
      camera.position.addScaledVector(fwd, -back);
      camera.updateMatrixWorld();
      d += back;
    }
    const { near, far } = clipPlanes(d, sphere.radius, camera.position.distanceTo(controls.target), camera.ortho);
    if (Math.abs(near - camera.near) > near * 1e-3 || Math.abs(far - camera.far) > far * 1e-3) {
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  };
  stage.beforeRender.push(clip);

  // The pose now, and putting the camera at one.
  const current = (): Pose => ({
    target: controls.target.clone(),
    quat: camera.quaternion.clone(),
    half: camera.ortho ? camera.orthoHalf / camera.zoom : camera.position.distanceTo(controls.target) * tanV(),
  });
  const place = (p: Pose) => {
    controls.target.copy(p.target);
    camera.quaternion.copy(p.quat);
    camera.zoom = 1;
    if (camera.ortho) camera.orthoHalf = p.half;
    camera.position.copy(p.target).addScaledVector(BACK.clone().applyQuaternion(p.quat), p.half / tanV());
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };

  // Animated moves (~250 ms ease; at once with reduced motion). `goal` is where the running one
  // ends, so a held arrow key keeps adding to it instead of lagging behind.
  let frame = 0;
  let goal: Pose | null = null;
  const stop = () => {
    cancelAnimationFrame(frame);
    goal = null;
  };
  const animateTo = (to: Pose) => {
    const from = current();
    stop();
    goal = to;
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = still ? 1 : Math.min(1, (now - t0) / 250);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      place({
        target: from.target.clone().lerp(to.target, e),
        quat: from.quat.clone().slerp(to.quat, e),
        half: from.half * (to.half / from.half) ** e,
      });
      if (k < 1) frame = requestAnimationFrame(step);
      else {
        goal = null;
        controls.update();
      }
      moved();
    };
    if (still) step(t0);
    else frame = requestAnimationFrame(step);
  };
  controls.addEventListener("start", stop);

  const direction = () => BACK.clone().applyQuaternion((goal ?? current()).quat);
  const framing = (b: THREE.Box3, dir: THREE.Vector3, minRadius: number): Pose | null => {
    // The view's own size, not camera.aspect: the resize that sets that may not have run yet.
    const aspect = el.clientWidth && el.clientHeight ? el.clientWidth / el.clientHeight : camera.aspect;
    const pose = fitPose(b, dir, camera.fov, minRadius, aspect);
    if (!pose) return null;
    const half = camera.ortho ? pose.radius / Math.min(1, aspect) : pose.position.distanceTo(pose.target) * tanV();
    return { target: pose.target, quat: lookFrom(dir), half };
  };
  const fit = (b: THREE.Box3, minRadius = 0.02) => {
    const pose = framing(b, direction(), minRadius);
    if (!pose) return;
    stop();
    place(pose);
    controls.update();
    moved();
  };
  const frameTo = (b: THREE.Box3, dir: THREE.Vector3) => {
    const pose = framing(b, dir, 0.02);
    if (pose) animateTo(pose);
  };
  const view = (name: ViewName | "fit") => frameTo(shown(), name === "fit" ? direction() : new THREE.Vector3(...VIEWS[name]));
  const look = (dir: [number, number, number]) => frameTo(shown(), new THREE.Vector3(...dir));
  const orbit = (right: number, up: number) => {
    const from = goal ?? current();
    animateTo({ ...from, quat: lookFrom(orbitDir(BACK.clone().applyQuaternion(from.quat), right, up)) });
  };
  const frameBox = (b: THREE.Box3) => frameTo(b, direction());

  // Orthographic (Onshape's default) or perspective, remembered on this device.
  const setProjection = (p: Projection, remember = true) => {
    const pose = goal ?? current();
    stop();
    camera.setOrtho(p === "ortho");
    place(pose);
    controls.update();
    moved();
    if (remember)
      try {
        localStorage.setItem(STORE, p);
      } catch {}
  };
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(STORE);
  } catch {}
  camera.setOrtho(saved !== "perspective");

  const pose = (): ViewPose => {
    const p = goal ?? current();
    return { target: p.target.toArray(), dir: BACK.clone().applyQuaternion(p.quat).toArray(), half: p.half, projection: camera.ortho ? "ortho" : "perspective" };
  };
  const setPose = (vp: ViewPose, animate = true) => {
    if ((vp.projection === "ortho") !== camera.ortho) setProjection(vp.projection, false);
    const to = { target: new THREE.Vector3(...vp.target), quat: lookFrom(new THREE.Vector3(...vp.dir)), half: vp.half };
    if (animate) animateTo(to);
    else {
      stop();
      place(to);
      controls.update();
      moved();
    }
  };

  // The point on the model under the pointer (the nearest one not cut away by a section).
  const ray = new THREE.Raycaster();
  const hitAt = (x: number, y: number): THREE.Vector3 | null => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    camera.updateMatrixWorld();
    ray.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1)), camera);
    const hits = ray.intersectObjects(
      meshes.filter((m) => m.mesh.visible).map((m) => m.mesh),
      false,
    );
    const planes = renderer.clippingPlanes;
    return hits.find((h) => planes.every((p) => p.distanceToPoint(h.point) >= 0))?.point ?? null;
  };
  // Look at the same spot, but with the centre at the depth of `p`: rotating and zooming then work
  // about it, and nothing on screen moves.
  const centreAtDepthOf = (p: THREE.Vector3) => {
    camera.getWorldDirection(fwd);
    const depth = p.clone().sub(camera.position).dot(fwd);
    if (depth > 1e-6) controls.target.copy(camera.position).addScaledVector(fwd, depth);
  };

  // Rotate by a drag of (dx, dy) px about `pivot`: the whole view (camera and its centre) turns
  // rigidly about it, about the vertical and the screen's horizontal, never past the poles.
  const rotateBy = (dx: number, dy: number, pivot: THREE.Vector3) => {
    const h = canvas.clientHeight || 1;
    const dir = camera.position.clone().sub(controls.target).normalize();
    const phi = Math.acos(THREE.MathUtils.clamp(dir.y, -1, 1));
    const tilt = phi - THREE.MathUtils.clamp(phi - (2 * Math.PI * dy) / h, POLE, Math.PI - POLE);
    const turn = new THREE.Quaternion().setFromAxisAngle(UP, (-2 * Math.PI * dx) / h);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).applyQuaternion(turn);
    const q = new THREE.Quaternion().setFromAxisAngle(right, -tilt).multiply(turn);
    camera.position.sub(pivot).applyQuaternion(q).add(pivot);
    controls.target.sub(pivot).applyQuaternion(q).add(pivot);
    camera.quaternion.premultiply(q);
    camera.updateMatrixWorld();
    controls.update();
    moved();
  };
  let drag: { id: number; x: number; y: number; x0: number; y0: number; pivot: THREE.Vector3 | null } | null = null;
  const touches = new Set<number>();
  const onDown = (e: PointerEvent) => {
    stop();
    if (e.pointerType === "touch") {
      touches.add(e.pointerId);
      // A second finger: OrbitControls pinches and moves.
      if (touches.size > 1) return void (drag = null);
    } else if (e.button !== 0 && e.button !== 2) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, pivot: null };
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.pivot) {
      // Started rotating: find the point under where the drag began (once; a tap costs nothing).
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 3) return;
      const hit = hitAt(drag.x0, drag.y0);
      if (hit) centreAtDepthOf(hit);
      drag.pivot = hit ?? controls.target.clone();
    }
    rotateBy(e.clientX - drag.x, e.clientY - drag.y, drag.pivot);
    drag.x = e.clientX;
    drag.y = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (drag?.id === e.pointerId) drag = null;
  };
  // The wheel zooms toward the point under the pointer: move the centre to its depth first (once
  // per wheel gesture), so zooming slows down as it nears the surface instead of passing through.
  let lastWheel = { t: 0, x: 0, y: 0 };
  const onWheel = (e: WheelEvent) => {
    stop();
    if (camera.ortho) return;
    const t = performance.now();
    const same = t - lastWheel.t < 200 && Math.hypot(e.clientX - lastWheel.x, e.clientY - lastWheel.y) < 4;
    lastWheel = { t, x: e.clientX, y: e.clientY };
    if (same) return;
    const hit = hitAt(e.clientX, e.clientY);
    if (hit) centreAtDepthOf(hit);
  };
  canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  // Capture on the parent: runs before OrbitControls' own wheel listener on the canvas.
  el.addEventListener("wheel", onWheel, { capture: true, passive: true });

  // Keys, for this viewer while the mouse is over it or it was the last thing touched; not while
  // typing, nor with a window open over it.
  let over = false;
  let focused = false;
  let shortcuts: (() => void) | null = null;
  const onEnter = () => (over = true);
  const onLeave = () => (over = false);
  const onAnyDown = (e: PointerEvent) => (focused = el.contains(e.target as Node));
  const onKey = (e: KeyboardEvent) => {
    if ((!over && !focused) || e.defaultPrevented) return;
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]")) return;
    if ([...document.querySelectorAll("dialog[open]")].some((d) => !d.contains(el))) return;
    const cmd = keyCommand(e);
    if (!cmd) return;
    if (cmd.kind === "help") {
      if (!shortcuts || e.repeat) return;
      shortcuts();
    } else if (cmd.kind === "fit") view("fit");
    else if (cmd.kind === "view") view(cmd.name);
    else orbit(cmd.right, cmd.up);
    e.preventDefault();
  };
  el.addEventListener("pointerenter", onEnter);
  el.addEventListener("pointerleave", onLeave);
  window.addEventListener("pointerdown", onAnyDown, true);
  window.addEventListener("keydown", onKey);

  return {
    controls,
    fit,
    tools: {
      view,
      look,
      orbit,
      frameBox,
      projection: () => (camera.ortho ? "ortho" : "perspective"),
      setProjection: (p) => setProjection(p),
      pose,
      setPose,
      watch: (turned) => {
        watchers.add(turned);
        turned(camera.quaternion);
        return () => watchers.delete(turned);
      },
      onShortcuts: (open) => (shortcuts = open),
    },
    dispose: () => {
      stop();
      watchers.clear();
      controls.dispose();
      canvas.removeEventListener("mousedown", noAutoScroll);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      el.removeEventListener("wheel", onWheel, { capture: true });
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onAnyDown, true);
      window.removeEventListener("keydown", onKey);
      stage.beforeRender.splice(stage.beforeRender.indexOf(clip), 1);
    },
  };
}
