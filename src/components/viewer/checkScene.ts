// The Design check's view of the loaded model (src/lib/check/, plan/design-check.md): every
// placed copy of every part with its mesh (and BVH) and where it sits. Geometry sketches are left
// out. Hidden copies count: the check is about the robot, not what's on screen.
import * as THREE from "three";
import type { Topology } from "@/lib/model/topology";
import type { PartMesh } from "./types";

export type CheckPart = {
  key: string;
  g: number; // subsystem group (ViewerModel.groups)
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4; // model space, metres
  flat?: (tri: number) => boolean; // the triangle lies on a flat face, once topology is in
};
export type CheckTools = { checkParts: () => CheckPart[] };

export function createCheckTools(meshes: PartMesh[], place: (m: number, i: number, out: THREE.Matrix4) => THREE.Matrix4): CheckTools {
  return {
    checkParts: () =>
      meshes.flatMap(({ mesh, keys, g, sketch }, m) => {
        if (sketch) return [];
        const topo = mesh.geometry.userData.topology as Topology | undefined;
        const flat = topo ? (tri: number) => topo.faces[topo.triFace[tri]]?.kind === "plane" : undefined;
        return keys.map((key, i) => ({ key, g, geometry: mesh.geometry, matrix: place(m, i, new THREE.Matrix4()), flat }));
      }),
  };
}
