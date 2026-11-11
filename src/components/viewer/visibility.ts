// What's drawn: parts hidden with Y or Hide (each copy on its own), Isolate (only some parts, the
// others as see-through ghosts or hidden), parts made see-through, and subsystems hidden by the page.
import * as THREE from "three";
import type { Looks } from "./paint";
import type { Gone, PartMesh } from "./types";

const GONE = new THREE.Matrix4().makeScale(0, 0, 0); // a hidden instance: drawn at no size, never hit
const CLEAR_OPACITY = 0.3; // "Make transparent"

// What's hidden, isolated and see-through, in a form that survives a reload (S6's saved views): a
// hidden copy is its part key and where it sits (assembly metres), so it's found again even if the
// meshes load in another order.
export type VisibilityState = {
  hidden: { key: string; at: [number, number, number] }[];
  isolated: string[] | null;
  ghost: boolean; // isolate shows the others as see-through ghosts (else hides them)
  clear: string[]; // parts made see-through
};

export type VisibilityTools = {
  hideKey: (key: string) => void; // every copy of the part
  // Onshape's Hide other instances / Show other instances: the part's other copies than this one.
  hideOthers: (g: Gone) => void;
  showOthers: (g: Gone) => void;
  // Show only these parts (all copies); the others are hidden, or see-through ghosts with `ghost`.
  isolate: (keys: string[] | null, opts?: { ghost?: boolean }) => void;
  showAll: () => void; // every hidden copy back, and Isolate ended
  setClear: (keys: string[], clear: boolean) => void; // Make transparent / Make opaque
  isClear: (key: string) => boolean;
  zoomTo: (keys: string[]) => void; // frame these parts' shown copies
  visibilityState: () => VisibilityState;
  setVisibilityState: (s: VisibilityState) => void;
};

export type Visibility = {
  hideOne: (g: Gone) => void;
  show: (back: Gone[]) => void;
  gone: () => Gone[]; // oldest first
  hideGroups: (hidden: Set<number>) => void;
  shownBox: () => THREE.Box3; // what's drawn now, for Fit and the views
  // The hidden copy nearest along the ray (even behind a shown part), and its kept placement.
  hiddenAt: (ray: THREE.Raycaster) => { g: Gone; at: THREE.Matrix4 } | null;
  isolated: () => { keys: string[]; ghost: boolean } | null;
  repaint: () => void; // the paint just set every mesh's material: put see-through parts back
  // A copy's place (its kept one while hidden), and moving it there (motion.ts: explode, Move).
  place: (m: number, i: number, out: THREE.Matrix4) => THREE.Matrix4;
  setPlace: (m: number, i: number, at: THREE.Matrix4) => void;
  tools: VisibilityTools;
  dispose: () => void;
};

export function createVisibility(
  meshes: PartMesh[],
  root: THREE.Object3D,
  looks: Looks,
  on: {
    changed: () => void; // anything shown or hidden: redraw what depends on it (the selection)
    hidden: (gone: Gone[]) => void; // the list of hidden copies changed
    isolated: (keys: string[] | null) => void; // Isolate turned on, changed or ended
    hoverOff: () => void; // a copy was hidden: drop the hover wash
    fit: (box: THREE.Box3) => void;
  },
): Visibility {
  // Hidden instances keep their place here and are drawn at no size meanwhile.
  const kept = new Map<string, THREE.Matrix4>();
  let goneList: Gone[] = [];
  const hideQuiet = (g: Gone) => {
    const id = `${g.m}:${g.i}`;
    if (kept.has(id)) return false;
    const { mesh } = meshes[g.m];
    const was = new THREE.Matrix4();
    mesh.getMatrixAt(g.i, was);
    kept.set(id, was);
    mesh.setMatrixAt(g.i, GONE);
    mesh.instanceMatrix.needsUpdate = true;
    goneList = [...goneList, g];
    return true;
  };
  const hideMany = (gs: Gone[]) => {
    let any = false;
    for (const g of gs) any = hideQuiet(g) || any;
    if (!any) return;
    on.hidden(goneList);
    on.hoverOff();
    on.changed();
  };
  const hideOne = (g: Gone) => hideMany([g]);
  const show = (back: Gone[]) => {
    for (const g of back) {
      const id = `${g.m}:${g.i}`;
      const was = kept.get(id);
      if (!was) continue;
      meshes[g.m].mesh.setMatrixAt(g.i, was);
      meshes[g.m].mesh.instanceMatrix.needsUpdate = true;
      kept.delete(id);
    }
    goneList = goneList.filter((g) => kept.has(`${g.m}:${g.i}`));
    on.hidden(goneList);
    on.hoverOff();
    on.changed();
  };
  const shownBox = () => {
    const box = new THREE.Box3();
    for (const { mesh } of meshes) if (mesh.visible) box.expandByObject(mesh);
    return box;
  };
  // A part's every copy hidden (the touch way to Y).
  const hideKey = (key: string) => {
    const gs: Gone[] = [];
    meshes.forEach(({ keys }, m) => keys.forEach((k, i) => k === key && gs.push({ m, i, key })));
    hideMany(gs);
  };

  const hideOthers = (g: Gone) => {
    const gs: Gone[] = [];
    meshes.forEach(({ keys }, m) => keys.forEach((k, i) => k === g.key && !(m === g.m && i === g.i) && gs.push({ m, i, key: k })));
    hideMany(gs);
  };
  const showOthers = (g: Gone) => show(goneList.filter((x) => x.key === g.key && !(x.m === g.m && x.i === g.i)));

  // Shift+Y: the hidden copies tested at their kept places, one throwaway mesh each, through
  // intersectObject (so a BVH on the geometry speeds it up too).
  const probe = new THREE.Mesh();
  probe.matrixAutoUpdate = false;
  const hiddenAt = (ray: THREE.Raycaster) => {
    let best: { g: Gone; at: THREE.Matrix4; d: number } | null = null;
    for (const g of goneList) {
      const { mesh } = meshes[g.m];
      const at = kept.get(`${g.m}:${g.i}`);
      if (!at || !mesh.visible) continue;
      probe.geometry = mesh.geometry;
      probe.matrixWorld.multiplyMatrices(mesh.matrixWorld, at);
      const [hit] = ray.intersectObject(probe, false);
      if (hit && (!best || hit.distance < best.d)) best = { g, at, d: hit.distance };
    }
    return best && { g: best.g, at: best.at };
  };

  // Isolate: the parts left out are hidden, and drawn again as ghosts (the Locate see-through
  // look) by a second instanced mesh sharing their matrices, so a copy hidden with Y stays hidden
  // there too. Ghosts are never picked.
  let isolated: Set<string> | null = null;
  // No ghosts unless asked for, like Onshape's Isolate (Harel, 2026-11-11).
  let ghost = false;
  let groupsHidden = new Set<number>();
  const ghosts = new THREE.Group();
  root.add(ghosts);
  const applyVisible = () => {
    ghosts.clear();
    for (const { mesh, g, keys } of meshes) {
      const inGroup = !groupsHidden.has(g);
      mesh.visible = inGroup && (!isolated || keys.some((k) => isolated!.has(k)));
      if (inGroup && !mesh.visible && ghost) {
        const shade = new THREE.InstancedMesh(mesh.geometry, looks.ghost, mesh.count);
        shade.instanceMatrix = mesh.instanceMatrix;
        shade.frustumCulled = false;
        shade.raycast = () => {};
        ghosts.add(shade);
      }
    }
    on.changed();
  };
  // Hiding a subsystem hides its meshes; the framing stays where it is.
  const hideGroups = (hidden: Set<number>) => {
    groupsHidden = hidden;
    applyVisible();
  };
  const isolate = (keys: string[] | null, opts?: { ghost?: boolean }) => {
    isolated = keys?.length ? new Set(keys) : null;
    ghost = opts?.ghost ?? false;
    applyVisible();
    on.isolated(isolated && [...isolated]);
    on.fit(shownBox());
  };
  const showAll = () => {
    if (goneList.length) show(goneList);
    if (isolated) isolate(null);
  };

  // Make transparent: the part's meshes get a see-through copy of whatever material the paint gave
  // them (so CAD / status colours stay), kept until Make opaque.
  const clear = new Set<string>();
  const clones = new Map<THREE.Material, THREE.Material>(); // painted → see-through
  const origin = new Map<THREE.Material, THREE.Material>(); // see-through → painted
  const seeThrough = (base: THREE.Material) => {
    let c = clones.get(base);
    if (!c) {
      c = base.clone();
      c.transparent = true;
      c.opacity = Math.min(base.opacity, CLEAR_OPACITY);
      c.depthWrite = false;
      clones.set(base, c);
      origin.set(c, base);
    }
    return c;
  };
  const applyClear = () => {
    for (const { mesh, keys } of meshes) {
      const cur = mesh.material as THREE.Material;
      const base = origin.get(cur) ?? cur;
      mesh.material = base !== looks.ghost && keys.some((k) => clear.has(k)) ? seeThrough(base) : base;
    }
    on.changed();
  };
  const setClear = (keys: string[], see: boolean) => {
    for (const k of keys) {
      if (see) clear.add(k);
      else clear.delete(k);
    }
    applyClear();
  };

  // Zoom to: the box of the parts' shown copies.
  const zoomTo = (keys: string[]) => {
    const want = new Set(keys);
    const box = new THREE.Box3();
    const piece = new THREE.Box3();
    const at = new THREE.Matrix4();
    meshes.forEach(({ mesh, keys: ks }, m) => {
      if (!mesh.visible) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      ks.forEach((k, i) => {
        if (!want.has(k) || kept.has(`${m}:${i}`)) return;
        mesh.getMatrixAt(i, at);
        box.union(piece.copy(mesh.geometry.boundingBox!).applyMatrix4(at.premultiply(mesh.matrixWorld)));
      });
    });
    if (!box.isEmpty()) on.fit(box);
  };

  const visibilityState = (): VisibilityState => ({
    hidden: goneList.map((g) => {
      const p = new THREE.Vector3().setFromMatrixPosition(kept.get(`${g.m}:${g.i}`)!);
      return { key: g.key, at: [p.x, p.y, p.z] };
    }),
    isolated: isolated && [...isolated],
    ghost,
    clear: [...clear],
  });
  // Each saved hidden copy: the copy of that part nearest to where it was (within 1 mm).
  const setVisibilityState = (s: VisibilityState) => {
    if (goneList.length) show(goneList);
    const gs: Gone[] = [];
    const at = new THREE.Matrix4();
    const p = new THREE.Vector3();
    for (const h of s.hidden) {
      let best: Gone | null = null;
      let bestD = 0.001;
      meshes.forEach(({ mesh, keys }, m) =>
        keys.forEach((k, i) => {
          if (k !== h.key) return;
          mesh.getMatrixAt(i, at);
          const d = p.setFromMatrixPosition(at).distanceTo(new THREE.Vector3(...h.at));
          if (d <= bestD && !gs.some((g) => g.m === m && g.i === i)) [best, bestD] = [{ m, i, key: k }, d];
        }),
      );
      if (best) gs.push(best);
    }
    hideMany(gs);
    clear.clear();
    s.clear.forEach((k) => clear.add(k));
    applyClear();
    isolated = s.isolated?.length ? new Set(s.isolated) : null;
    ghost = s.ghost;
    applyVisible();
    on.isolated(isolated && [...isolated]);
  };

  return {
    hideOne,
    show,
    gone: () => goneList,
    hideGroups,
    shownBox,
    hiddenAt,
    isolated: () => (isolated ? { keys: [...isolated], ghost } : null),
    repaint: applyClear,
    place: (m, i, out) => {
      const was = kept.get(`${m}:${i}`);
      return was ? out.copy(was) : (meshes[m].mesh.getMatrixAt(i, out), out);
    },
    setPlace: (m, i, at) => {
      const was = kept.get(`${m}:${i}`);
      if (was) was.copy(at);
      else meshes[m].mesh.setMatrixAt(i, at);
    },
    tools: { hideKey, hideOthers, showOthers, isolate, showAll, setClear, isClear: (k) => clear.has(k), zoomTo, visibilityState, setVisibilityState },
    // Ghosts share their mesh's matrices: only dropped, never disposed (that would free the
    // shared buffer).
    dispose: () => {
      ghosts.clear();
      clones.forEach((c) => c.dispose());
    },
  };
}
