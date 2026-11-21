// The view cube's Quality slider (Harel, 2026-11-19): it only lets the device run the 3D view
// smoothly, never changes what the model looks like as data (that's the view state). Each step
// sets what is cheap to switch while the view is open: how many pixels are drawn (the renderer's
// pixel ratio), the silhouette outlines of curved parts (one more draw of every part), and the
// studio reflections (CAD colours). Picked per device at first, then remembered on the device.
import type * as THREE from "three";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type Quality = 0 | 1 | 2; // Low, Medium, High
export const QUALITY_LABELS = ["Low", "Medium", "High"] as const;

type Step = {
  sharp: number; // pixel ratio cap while the view is still
  moving: number; // pixel ratio cap while it moves (the "lower sharpness while moving" phones had)
  outlines: boolean; // silhouettes while still
  outlinesMoving: boolean;
  studio: boolean; // the studio environment's reflections
};
// High keeps the old desktop look (sharp at up to 2× while moving); phones always drop to 1× while
// the view moves, as before. Medium draws about half the pixels of a 2× screen. Low draws one
// pixel per CSS pixel, less while moving, with no silhouettes or reflections.
const steps = (coarse: boolean): Record<Quality, Step> => ({
  0: { sharp: 1, moving: 0.75, outlines: false, outlinesMoving: false, studio: false },
  1: { sharp: 1.5, moving: 1, outlines: true, outlinesMoving: false, studio: true },
  2: { sharp: 2, moving: coarse ? 1 : 2, outlines: true, outlinesMoving: !coarse, studio: true },
});

const KEY = "orbitparts:view-quality";
const isQuality = (x: unknown): x is Quality => x === 0 || x === 1 || x === 2;
const coarse = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

// Phones and tablets (touch) or small windows start at Medium, desktops at High.
export function defaultQuality(): Quality {
  if (typeof window === "undefined") return 2;
  const small = Math.min(window.screen.width, window.screen.height) < 600;
  return coarse() || small ? 1 : 2;
}

export function savedQuality(): Quality {
  try {
    const v = Number(localStorage.getItem(KEY) ?? NaN);
    if (isQuality(v)) return v;
  } catch {
    // private mode or blocked storage: the device's default
  }
  return defaultQuality();
}

function saveQuality(q: Quality) {
  try {
    localStorage.setItem(KEY, String(q));
  } catch {
    // not remembered; still applied to this view
  }
}

export type QualityTools = {
  quality: () => Quality;
  // Applied at once and remembered on this device, unless `remember` is false (the Onshape
  // panel's narrow view starts at Low without changing the device's choice).
  setQuality: (q: Quality, remember?: boolean) => void;
};

// Wires a quality to the renderer and the camera controls' start / end (the view moving).
export function createQuality(
  renderer: THREE.WebGLRenderer,
  controls: OrbitControls,
  look: { outlines: (on: boolean) => void; studio: (on: boolean) => void },
  render: () => void,
) {
  const table = steps(coarse());
  const dpr = window.devicePixelRatio || 1;
  let q = savedQuality();
  let moving = false;
  const apply = () => {
    const s = table[q];
    const ratio = Math.min(dpr, moving ? s.moving : s.sharp);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    look.outlines(moving ? s.outlinesMoving : s.outlines);
    look.studio(s.studio);
  };
  apply();
  const onStart = () => {
    moving = true;
    apply();
  };
  const onEnd = () => {
    moving = false;
    apply();
    render();
  };
  controls.addEventListener("start", onStart);
  controls.addEventListener("end", onEnd);
  const tools: QualityTools = {
    quality: () => q,
    setQuality: (next, remember = true) => {
      if (!isQuality(next)) return;
      q = next;
      if (remember) saveQuality(q);
      apply();
      render();
    },
  };
  return {
    tools,
    dispose: () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
    },
  };
}
