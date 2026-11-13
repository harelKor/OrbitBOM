// Show on an overlapping pair (Harel, 2026-11-13), like Onshape's interference: every other part
// dimmed (Isolate with ghosts all the way out), the two made see-through, and where they overlap
// drawn red on top. Show all (or Esc) ends it: the page calls hideOverlap when Isolate ends.
import * as THREE from "three";
import type { SceneTools } from "@/components/viewer/types";
import { overlapShape } from "@/lib/check/overlap";
import type { Clash, DesignFinding } from "@/lib/check/types";

export function showOverlap(tools: SceneTools, c: Clash): void {
  const parts = tools.checkParts();
  const at = new THREE.Vector3(...c.at).multiplyScalar(0.001);
  const box = new THREE.Box3();
  // The copies nearest the clash's point (a pair can overlap in several places).
  const nearest = (key: string, not?: (typeof parts)[number]) => {
    let best: (typeof parts)[number] | null = null;
    let dist = Infinity;
    for (const p of parts) {
      if (p.key !== key || p === not) continue;
      if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
      const d = box.copy(p.geometry.boundingBox!).applyMatrix4(p.matrix).distanceToPoint(at);
      if (d < dist) [best, dist] = [p, d];
    }
    return best;
  };
  const a = nearest(c.a);
  const b = a && nearest(c.b, a);
  const keys = [...new Set([c.a, c.b])];
  tools.isolate(keys, { ghost: 1 });
  tools.setClear(keys, true);
  const shape = a && b && !c.same ? overlapShape(a, b) : null;
  const red = tools.showOverlap(shape);
  if (!red) return tools.zoomTo(keys);
  const size = red.getSize(new THREE.Vector3()).length();
  tools.frameBox(red.expandByScalar(Math.max(0.02, size)));
}

export function hideOverlap(tools: SceneTools, keys: string[]): void {
  tools.showOverlap(null);
  tools.setClear(keys, false);
}

// Show on any other finding: its parts with the rest dimmed, and a red dot on the spot.
export function markFinding(tools: SceneTools, f: DesignFinding): void {
  const keys = [...new Set(f.keys)];
  tools.isolate(keys, { ghost: 1 });
  if (!f.at) return tools.zoomTo(keys);
  const at = new THREE.Vector3(...f.at).multiplyScalar(0.001);
  const ball = new THREE.SphereGeometry(0.004, 16, 12).toNonIndexed();
  ball.translate(at.x, at.y, at.z);
  const tris = new Float32Array(ball.attributes.position.array);
  ball.dispose();
  const red = tools.showOverlap({ tris, lines: new Float32Array(), box: new THREE.Box3().setFromCenterAndSize(at, new THREE.Vector3(0.008, 0.008, 0.008)) });
  if (red) tools.frameBox(red.expandByScalar(0.06));
}
