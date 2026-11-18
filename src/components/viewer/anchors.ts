// Comments linked to a face, edge or corner (Harel, 2026-11-18, plan/cad-design-review.md): the
// newest pick as an anchor when a comment is written, finding it again on the model shown (by its
// number, else by its look, src/lib/reviews/anchor.ts), and a comment tag's tap: a close view of it
// from the current direction with it picked. No see-through, no isolate, no turning to the
// author's view.
import * as THREE from "three";
import { findAnchor, sigOf, type Anchor } from "@/lib/reviews/anchor";
import type { V3 } from "@/lib/model/topology";
import type { MeasureLayer } from "./measureLayer";
import type { Pick, Topo } from "./picking";
import type { Stage } from "./stage";
import type { PartMesh } from "./types";

export type AnchorTools = {
  pickAnchor: () => Anchor | null; // the newest pick as an anchor
  anchorPoint: (a: Anchor) => [number, number, number] | null; // where it is on the model shown, assembly mm
  showAnchor: (a: Anchor) => boolean; // close view and picked; false when it isn't on the model shown
  showPartAt: (key: string, at: [number, number, number] | null) => boolean; // an older comment's part: the copy nearest `at`
  hoverAnchor: (a: Anchor | null) => void; // drawn in hover blue (a comment under the pointer)
};

// Never framed closer than this across (m): a single edge still shows what's around it.
const MIN_SPAN = 0.12;

export function createAnchors(stage: Stage, meshes: PartMesh[], topo: Topo, measure: () => MeasureLayer | null, frameBox: (box: THREE.Box3) => void): AnchorTools {
  const arrays = (m: number) => {
    const g = meshes[m].mesh.geometry;
    return { pos: g.getAttribute("position").array, idx: g.index!.array };
  };
  const toMm = (p: THREE.Vector3): [number, number, number] => [Math.round(p.x * 1e5) / 100, Math.round(p.y * 1e5) / 100, Math.round(p.z * 1e5) / 100];
  const copies = (key: string) => {
    const out: { m: number; i: number }[] = [];
    meshes.forEach((pm, m) => {
      if (pm.sketch) return;
      pm.keys.forEach((k, i) => k === key && out.push({ m, i }));
    });
    return out;
  };
  const centreMm = (sigC: V3, m: number, i: number) => toMm(new THREE.Vector3(sigC[0] / 1000, sigC[1] / 1000, sigC[2] / 1000).applyMatrix4(topo.placeOf(m, i)));
  const dist = (a: [number, number, number], b: [number, number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // The anchor on the model shown: the part copy nearest where it was written, and its face / edge.
  const cache = new Map<string, { pk: Pick; at: [number, number, number] } | null>();
  const locate = (a: Anchor) => {
    const id = `${a.key}|${a.kind}|${a.n}|${a.sig.c.join(",")}|${a.at.join(",")}|${meshes.length}`;
    if (cache.has(id)) return cache.get(id)!;
    let best: { pk: Pick; at: [number, number, number]; d: number } | null = null;
    const found = new Map<number, number>(); // per mesh: one search for every copy
    for (const { m, i } of copies(a.key)) {
      if (!found.has(m)) {
        const { pos, idx } = arrays(m);
        found.set(m, findAnchor(topo.topoOf(m), pos, idx, a));
      }
      const n = found.get(m)!;
      if (n < 0) continue;
      const { pos, idx } = arrays(m);
      const s = sigOf(topo.topoOf(m), pos, idx, a.kind, n);
      if (!s) continue;
      const at = centreMm(s.c, m, i);
      const d = dist(at, a.at);
      if (!best || d < best.d) best = { pk: { m, i, kind: a.kind, n }, at, d };
    }
    const r = best && { pk: best.pk, at: best.at };
    cache.set(id, r);
    return r;
  };

  // A pick's own box, world space: a face's triangles, an edge's points, a corner.
  const boxOf = (pk: Pick) => {
    const t = topo.topoOf(pk.m);
    const place = topo.placeOf(pk.m, pk.i).premultiply(stage.root.matrixWorld);
    const box = new THREE.Box3();
    const q = new THREE.Vector3();
    if (pk.kind === "face") {
      const { pos, idx } = arrays(pk.m);
      for (const tri of t.faces[pk.n].tris)
        for (let k = 0; k < 3; k++) {
          const j = idx[tri * 3 + k] * 3;
          box.expandByPoint(q.set(pos[j], pos[j + 1], pos[j + 2]).applyMatrix4(place));
        }
    } else if (pk.kind === "edge") for (const p of t.edges[pk.n].points) box.expandByPoint(q.set(...p).applyMatrix4(place));
    else box.expandByPoint(q.set(...t.corners[pk.n]).applyMatrix4(place));
    return box;
  };
  const frame = (box: THREE.Box3) => {
    const size = box.getSize(new THREE.Vector3());
    const grow = Math.max(0, (MIN_SPAN - Math.max(size.x, size.y, size.z)) / 2);
    // A margin all round, so the face / edge sits in its surroundings.
    box.expandByScalar(grow + Math.max(size.x, size.y, size.z) * 0.25);
    frameBox(box);
  };

  return {
    pickAnchor: () => {
      const pk = measure()?.newest();
      if (!pk || !meshes[pk.m] || meshes[pk.m].sketch) return null;
      const key = meshes[pk.m].keys[pk.i];
      const { pos, idx } = arrays(pk.m);
      const sig = key ? sigOf(topo.topoOf(pk.m), pos, idx, pk.kind, pk.n) : null;
      if (!key || !sig) return null;
      return { key, kind: pk.kind, n: pk.n, sig, at: centreMm(sig.c, pk.m, pk.i) };
    },
    anchorPoint: (a) => locate(a)?.at ?? null,
    showAnchor: (a) => {
      const hit = locate(a);
      if (!hit) return false;
      measure()?.only(hit.pk);
      frame(boxOf(hit.pk));
      return true;
    },
    showPartAt: (key, at) => {
      const list = copies(key);
      if (!list.length) return false;
      const centre = (c: { m: number; i: number }) => {
        const g = meshes[c.m].mesh.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        return toMm(g.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(topo.placeOf(c.m, c.i)));
      };
      const one = at ? list.reduce((b, c) => (dist(centre(c), at) < dist(centre(b), at) ? c : b)) : list[0];
      measure()?.only(one);
      const g = meshes[one.m].mesh.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      frame(g.boundingBox!.clone().applyMatrix4(topo.placeOf(one.m, one.i).premultiply(stage.root.matrixWorld)));
      return true;
    },
    hoverAnchor: (a) => {
      const hit = a ? locate(a) : null;
      if (measure()?.hover(hit?.pk ?? null)) stage.render();
    },
  };
}
