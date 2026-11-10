// Loading the model: fetch each Part Studio's mesh file, decode it, and build one instanced mesh
// per (subsystem, Part Studio, part) with its face borders.
import * as THREE from "three";
import { edgePositions } from "@/lib/model/edges";
import { decodeMeshes, type Appearance, type Mesh } from "@/lib/model/mesh";
import type { Looks } from "./paint";
import { PLAIN } from "./paint";
import type { Stage } from "./stage";
import type { PartMesh, ViewerModel } from "./types";

async function loadStudio(url: string): Promise<Mesh[]> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model file ${res.status}`);
  const buf = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  return decodeMeshes(buf);
}

type Shape = { geometry: THREE.BufferGeometry; edges: Float32Array; look?: Appearance };

// Downloads (6 at a time) and builds the model's meshes into `meshes`, added under the stage's
// root. Every geometry made goes into `geometries`, for the viewer to dispose of. Resolves false
// when `cancelled()` turned true on the way (nothing is added then).
export async function loadModel(
  stage: Stage,
  model: ViewerModel,
  looks: Looks,
  out: { meshes: PartMesh[]; geometries: THREE.BufferGeometry[] },
  progress: (done: number, total: number) => void,
  cancelled: () => boolean,
): Promise<boolean> {
  const { root } = stage;
  const { meshes, geometries } = out;
  const shapes: Map<string, Shape>[] = [];
  let done = 0;
  const queue = model.studios.map((url, i) => ({ url, i }));
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const byPart = new Map<string, Shape>();
      if (job.url) {
        for (const m of await loadStudio(job.url)) {
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
          g.setIndex(new THREE.BufferAttribute(m.indices, 1));
          g.computeVertexNormals();
          geometries.push(g);
          byPart.set(m.partId, { geometry: g, edges: edgePositions(m.positions, m.indices), look: m.appearance });
        }
      }
      shapes[job.i] = byPart;
      if (!cancelled()) progress(++done, model.studios.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (cancelled()) return false;

  // One instanced mesh per (subsystem, Part Studio, part).
  const groups = new Map<string, Shape & { items: typeof model.placements; g: number }>();
  for (const p of model.placements) {
    const partId = p.k.slice(p.k.lastIndexOf(":") + 1);
    const shape = shapes[p.s]?.get(partId);
    if (!shape) continue;
    const id = `${p.g ?? 0}|${p.s}|${partId}`;
    const group = groups.get(id) ?? { ...shape, items: [], g: p.g ?? 0 };
    group.items.push(p);
    groups.set(id, group);
  }
  const m = new THREE.Matrix4();
  for (const { geometry, edges, look, items, g } of groups.values()) {
    const mesh = new THREE.InstancedMesh(geometry, looks.material, items.length);
    items.forEach((p, i) => {
      const t = p.t;
      m.set(t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], t[9], t[10], t[11], t[12], t[13], t[14], t[15]);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, new THREE.Color(PLAIN));
    });
    mesh.computeBoundingSphere();
    mesh.computeBoundingBox();
    if (edges.length) {
      // A child of its mesh: hidden with it (subsystems, Only this), sharing its matrices.
      const lines = new THREE.InstancedBufferGeometry();
      lines.setAttribute("position", new THREE.BufferAttribute(edges, 3));
      lines.setAttribute("instanceMatrix", mesh.instanceMatrix);
      lines.instanceCount = items.length;
      lines.boundingBox = mesh.boundingBox!.clone(); // so framing measures the copies, not the origin
      geometries.push(lines);
      const segs = new THREE.LineSegments(lines, looks.edgeLook);
      segs.frustumCulled = false;
      segs.raycast = () => {};
      mesh.add(segs);
    }
    root.add(mesh);
    meshes.push({ mesh, keys: items.map((p) => p.k), g, look });
  }
  root.updateMatrixWorld(true);
  return true;
}

export type PartTools = { partSize: (key: string) => [number, number, number] | null };

// The part's size along the model's axes, in mm (its first copy's box).
export function partTools(meshes: PartMesh[]): PartTools {
  const partSize = (key: string): [number, number, number] | null => {
    for (const { mesh, keys } of meshes) {
      const i = keys.indexOf(key);
      if (i < 0) continue;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const at = new THREE.Matrix4();
      mesh.getMatrixAt(i, at);
      const size = mesh.geometry.boundingBox!.clone().applyMatrix4(at).getSize(new THREE.Vector3());
      return [size.x * 1000, size.y * 1000, size.z * 1000];
    }
    return null;
  };
  return { partSize };
}
