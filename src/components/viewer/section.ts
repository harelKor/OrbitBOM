// The section: one clipping plane across the model's box, at a fraction of it along an axis.
import * as THREE from "three";
import type { Stage } from "./stage";

export type Axis = "x" | "y" | "z";
export type Section = { axis: Axis; at: number; flip: boolean };
export type SectionTools = { section: (s: Section | null) => void };

// The plane for `s` across `box` (the model's box in world space): it keeps the side below `at`
// (above it when flipped).
export function sectionPlane(box: THREE.Box3, s: Section, out = new THREE.Plane()): THREE.Plane {
  const i = s.axis === "x" ? 0 : s.axis === "y" ? 1 : 2;
  const at = box.min.getComponent(i) + (box.max.getComponent(i) - box.min.getComponent(i)) * s.at;
  return out.set(new THREE.Vector3().setComponent(i, s.flip ? 1 : -1), s.flip ? -at : at);
}

// `materials`: the part materials that show their inside faces while cut.
export function createSection(stage: Stage, materials: THREE.Material[]): SectionTools {
  const { renderer, root, render } = stage;
  const plane = new THREE.Plane();
  const section = (s: Section | null) => {
    for (const m of materials) {
      m.side = s ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    }
    if (!s) renderer.clippingPlanes = [];
    else {
      sectionPlane(new THREE.Box3().setFromObject(root), s, plane);
      renderer.clippingPlanes = [plane];
    }
    render();
  };
  return { section };
}
