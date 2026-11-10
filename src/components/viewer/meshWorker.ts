// The 3D viewer's heavy lifting, off the main thread so the page stays responsive while a robot
// loads: each Part Studio file is read (from the browser's cache when it has it, meshCache.ts),
// unzipped and decoded, and every part gets its normals, face-border edges and a BVH for fast
// hover and picks (three-mesh-bvh). The BVH reorders the triangles, so edges and topology are
// worked out after it, on the same order the main thread draws. Everything goes back as
// transferable buffers (moved, not copied). load.ts runs a few of these at once.
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { edgePositions } from "@/lib/model/edges";
import { decodeMeshes, type Appearance } from "@/lib/model/mesh";
import { topology, type Topology } from "@/lib/model/topology";
import { meshFile, sweepMeshCache } from "./meshCache";

export type WorkerJob =
  | { kind: "studio"; id: number; url: string; key: string | null }
  | { kind: "topology"; id: number } // the faces / edges / corners of studio `id`'s parts, once drawn
  | { kind: "sweep"; keys: string[] }; // drop cached files this model doesn't need (meshCache.ts)

export type Shape = {
  partId: string;
  positions: Float32Array;
  normals: Float32Array;
  index: Uint32Array;
  edges: Float32Array;
  bvh: ArrayBuffer[]; // MeshBVH roots, for MeshBVH.deserialize on the same index
  appearance?: Appearance;
};

export type WorkerReply =
  | { kind: "studio"; id: number; shapes: Shape[] }
  | { kind: "topology"; id: number; topology: Topology[] }
  | { kind: "swept" }
  | { kind: "failed"; id: number; error: string };

const post = (msg: WorkerReply, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

// Each studio's positions and index, kept until its topology is asked for (after the model is
// drawn, so it never holds up the drawing).
const kept = new Map<number, { positions: Float32Array; index: Uint32Array }[]>();

async function studio(id: number, url: string, key: string | null) {
  const gz = await meshFile(url, key);
  const buf = await new Response(new Response(gz).body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  const shapes: Shape[] = [];
  const transfer: Transferable[] = [];
  const keep: { positions: Float32Array; index: Uint32Array }[] = [];
  for (const m of decodeMeshes(buf)) {
    // Own buffers per part (decodeMeshes gives views into one file buffer), so each can move.
    const positions = m.positions.slice();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setIndex(new THREE.BufferAttribute(m.indices.slice(), 1));
    const bvh = new MeshBVH(g); // reorders g's index in place
    g.computeVertexNormals();
    const index = g.index!.array as Uint32Array;
    const normals = g.getAttribute("normal").array as Float32Array;
    const roots = MeshBVH.serialize(bvh, { cloneBuffers: false }).roots as ArrayBuffer[];
    const edges = edgePositions(positions, index);
    keep.push({ positions: positions.slice(), index: index.slice() });
    shapes.push({ partId: m.partId, positions, normals, index, edges, bvh: roots, ...(m.appearance && { appearance: m.appearance }) });
    transfer.push(positions.buffer, normals.buffer, index.buffer, edges.buffer, ...roots);
  }
  kept.set(id, keep);
  post({ kind: "studio", id, shapes }, transfer);
}

self.onmessage = async (e: MessageEvent<WorkerJob>) => {
  const job = e.data;
  if (job.kind === "sweep") {
    await sweepMeshCache(job.keys);
    return post({ kind: "swept" });
  }
  if (job.kind === "topology") {
    const parts = kept.get(job.id) ?? [];
    kept.delete(job.id);
    const topo = parts.map((p) => topology(p.positions, p.index));
    return post({ kind: "topology", id: job.id, topology: topo }, topo.map((t) => t.triFace.buffer));
  }
  try {
    await studio(job.id, job.url, job.key);
  } catch (err) {
    post({ kind: "failed", id: job.id, error: err instanceof Error ? err.message : String(err) });
  }
};
