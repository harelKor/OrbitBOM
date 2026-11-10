// Camera controls, Fit and the standard views.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Stage } from "./stage";

export type ViewName = "front" | "top" | "side" | "iso";
// Directions from the model to the camera, in the scene's Y-up frame (Onshape's Z is up).
export const VIEWS: Record<ViewName, [number, number, number]> = { front: [0, 0, 1], top: [0, 1, 0.0001], side: [1, 0, 0], iso: [1, 1, 1] };

export type CameraTools = { view: (name: ViewName | "fit") => void };
export type Camera = {
  controls: OrbitControls;
  // Frames a box (world space); `minRadius` keeps a tiny part from filling the screen.
  fit: (box: THREE.Box3, minRadius?: number) => void;
  tools: CameraTools;
  dispose: () => void;
};

// Where the camera goes to frame `box` from direction `dir` (target → camera), so the box's
// bounding sphere fits the vertical field of view. Null for an empty box.
export function fitPose(box: THREE.Box3, dir: THREE.Vector3, fovDeg: number, minRadius = 0.02): { target: THREE.Vector3; position: THREE.Vector3 } | null {
  if (box.isEmpty()) return null;
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, minRadius);
  const d = dir.clone().normalize();
  if (!d.lengthSq()) d.set(1, 0.7, 1).normalize();
  return { target: center, position: center.clone().addScaledVector(d, radius / Math.sin(THREE.MathUtils.degToRad(fovDeg / 2))) };
}

// Like Onshape: right drag rotates, middle drag moves, the wheel zooms (left drag also rotates,
// for touchpads). `shown` is the box of what's drawn now, for Fit and the views.
export function createCamera(stage: Stage, shown: () => THREE.Box3): Camera {
  const { camera, renderer, render } = stage;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  // A middle click on a link-free canvas still starts the browser's auto-scroll; stop it.
  const noAutoScroll = (e: MouseEvent) => e.button === 1 && e.preventDefault();
  renderer.domElement.addEventListener("mousedown", noAutoScroll);
  controls.addEventListener("change", render);

  const fit = (box: THREE.Box3, minRadius = 0.02) => {
    const pose = fitPose(box, camera.position.clone().sub(controls.target), camera.fov, minRadius);
    if (!pose) return;
    controls.target.copy(pose.target);
    camera.position.copy(pose.position);
    controls.update();
    render();
  };
  // Standard views and fit, framed on what's shown.
  const view = (name: ViewName | "fit") => {
    if (name !== "fit") {
      const [x, y, z] = VIEWS[name];
      const d = camera.position.distanceTo(controls.target);
      camera.position.copy(controls.target).addScaledVector(new THREE.Vector3(x, y, z).normalize(), d);
    }
    fit(shown());
  };

  return {
    controls,
    fit,
    tools: { view },
    dispose: () => {
      controls.dispose();
      renderer.domElement.removeEventListener("mousedown", noAutoScroll);
    },
  };
}
