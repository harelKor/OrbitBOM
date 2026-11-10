// What's drawn: parts hidden with Y or Hide (each copy on its own), Isolate (only some parts), and
// subsystems hidden by the page.
import * as THREE from "three";
import type { Gone, PartMesh } from "./types";

const GONE = new THREE.Matrix4().makeScale(0, 0, 0); // a hidden instance: drawn at no size, never hit

export type VisibilityTools = {
  hideKey: (key: string) => void;
  isolate: (keys: string[] | null) => void; // show only these parts (all copies)
};

export type Visibility = {
  hideOne: (g: Gone) => void;
  show: (back: Gone[]) => void;
  gone: () => Gone[]; // oldest first
  hideGroups: (hidden: Set<number>) => void;
  shownBox: () => THREE.Box3; // what's drawn now, for Fit and the views
  tools: VisibilityTools;
};

export function createVisibility(
  meshes: PartMesh[],
  on: {
    changed: () => void; // anything shown or hidden: redraw what depends on it (the selection)
    hidden: (gone: Gone[]) => void; // the list of hidden copies changed
    hoverOff: () => void; // a copy was hidden: drop the hover wash
    fit: (box: THREE.Box3) => void;
  },
): Visibility {
  // Hidden instances keep their place here and are drawn at no size meanwhile.
  const kept = new Map<string, THREE.Matrix4>();
  let goneList: Gone[] = [];
  const hideOne = (g: Gone) => {
    const { mesh } = meshes[g.m];
    const was = new THREE.Matrix4();
    mesh.getMatrixAt(g.i, was);
    kept.set(`${g.m}:${g.i}`, was);
    mesh.setMatrixAt(g.i, GONE);
    mesh.instanceMatrix.needsUpdate = true;
    goneList = [...goneList, g];
    on.hidden(goneList);
    on.hoverOff();
    on.changed();
  };
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
    on.changed();
  };
  const shownBox = () => {
    const box = new THREE.Box3();
    for (const { mesh } of meshes) if (mesh.visible) box.expandByObject(mesh);
    return box;
  };
  // A part's every copy hidden (the touch way to Y), or only that part shown.
  const hideKey = (key: string) => {
    meshes.forEach(({ keys }, m) => keys.forEach((k, i) => k === key && !kept.has(`${m}:${i}`) && hideOne({ m, i, key })));
  };
  let isolated: Set<string> | null = null;
  let groupsHidden = new Set<number>();
  const applyVisible = () => {
    for (const { mesh, g, keys } of meshes) mesh.visible = !groupsHidden.has(g) && (!isolated || keys.some((k) => isolated!.has(k)));
    on.changed();
  };
  // Hiding a subsystem hides its meshes; the framing stays where it is.
  const hideGroups = (hidden: Set<number>) => {
    groupsHidden = hidden;
    applyVisible();
  };
  const isolate = (keys: string[] | null) => {
    isolated = keys?.length ? new Set(keys) : null;
    applyVisible();
    on.fit(shownBox());
  };
  return { hideOne, show, gone: () => goneList, hideGroups, shownBox, tools: { hideKey, isolate } };
}
