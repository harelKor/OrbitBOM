// Show on a Design check overlap (Harel, 2026-11-13): where two parts overlap, drawn red over
// everything like Onshape's interference (the colour the section's caps use), with the line where
// their surfaces cross. The shape is worked out by src/lib/check/overlap.ts, in model space.
import * as THREE from "three";
import { INTERFERENCE } from "./sectionCaps";
import type { Stage } from "./stage";

export type OverlapTools = {
  // Draw it (null: take it away); returns its box in world space, for framing.
  showOverlap: (shape: { tris: Float32Array; lines: Float32Array; box: THREE.Box3 } | null) => THREE.Box3 | null;
};

export function createRedOverlap(stage: Stage): { tools: OverlapTools; dispose: () => void } {
  const group = new THREE.Group();
  stage.root.add(group);
  const fill = new THREE.MeshBasicMaterial({ color: INTERFERENCE, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
  const edge = new THREE.LineBasicMaterial({ color: "#8b0000", depthTest: false });
  const clear = () => {
    for (const o of [...group.children]) {
      group.remove(o);
      (o as THREE.Mesh).geometry.dispose();
    }
  };
  const showOverlap: OverlapTools["showOverlap"] = (shape) => {
    clear();
    if (!shape) {
      stage.render();
      return null;
    }
    if (shape.tris.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(shape.tris, 3));
      const mesh = new THREE.Mesh(g, fill);
      mesh.renderOrder = 20;
      mesh.raycast = () => {};
      group.add(mesh);
    }
    if (shape.lines.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(shape.lines, 3));
      const lines = new THREE.LineSegments(g, edge);
      lines.renderOrder = 21;
      lines.raycast = () => {};
      group.add(lines);
    }
    stage.root.updateMatrixWorld();
    stage.render();
    return shape.box.clone().applyMatrix4(stage.root.matrixWorld);
  };
  return {
    tools: { showOverlap },
    dispose: () => {
      clear();
      stage.root.remove(group);
      fill.dispose();
      edge.dispose();
    },
  };
}
