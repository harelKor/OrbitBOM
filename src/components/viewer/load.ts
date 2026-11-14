// Loading the model: each Part Studio's mesh file is read, decoded and prepared in Web Workers
// (meshWorker.ts, from the browser's cache when it has the file), and its parts are drawn as soon
// as it arrives: one instanced mesh per (subsystem, Part Studio, part) with its face borders.
import * as THREE from "three";
import { acceleratedRaycast, MeshBVH, type SerializedBVH } from "three-mesh-bvh";
import type { Shape, WorkerJob, WorkerReply } from "./meshWorker";
import type { Looks } from "./paint";
import { PLAIN } from "./paint";
import type { Stage } from "./stage";
import type { PartMesh, ViewerModel } from "./types";

// Hover and picks test a part's BVH (built in the worker) instead of every triangle: three's
// InstancedMesh raycast tests each copy through Mesh.raycast, so swapping that in once speeds up
// every raycast on the meshes below (picking.ts needs no change). Meshes without a BVH (the hover
// wash, marks) work as before. The copy's bounding sphere is checked first, as three does, so the
// thousands of copies the ray misses cost almost nothing and hidden copies (drawn at no size)
// are never hit.
const plainRaycast = THREE.Mesh.prototype.raycast;
const sphere = new THREE.Sphere();
THREE.Mesh.prototype.raycast = function (this: THREE.Mesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
  const geometry = this.geometry;
  if (!geometry.boundsTree) return plainRaycast.call(this, raycaster, hits);
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  sphere.copy(geometry.boundingSphere!).applyMatrix4(this.matrixWorld);
  if (!(sphere.radius > 0) || !raycaster.ray.intersectsSphere(sphere)) return;
  acceleratedRaycast.call(this, raycaster, hits);
};

// The box of where the shown parts sit (their placements' origins), in model space, padded a
// little since parts reach past their origins: the first Fit, before any mesh has arrived.
// Null when that says nothing useful (one placement, or every part placed at the same spot,
// as with Part Studios drawn in place), and the view frames the first meshes instead.
export function placementsBox(placements: ViewerModel["placements"], hidden?: Set<number>): THREE.Box3 | null {
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (const { t, g } of placements) if (!hidden?.has(g ?? 0)) box.expandByPoint(p.set(t[3], t[7], t[11]));
  if (box.isEmpty()) return null;
  const size = box.getSize(p).length();
  if (size < 0.1) return null;
  return box.expandByScalar(size * 0.08 + 0.05);
}

// Whether the real box of what's drawn is far enough from the first Fit's guess to frame again
// once everything is in (only if the camera wasn't touched meanwhile): its size off by more than a
// quarter, or its centre moved by more than a fifth of its size.
export function refitNeeded(guess: THREE.Box3, real: THREE.Box3): boolean {
  if (real.isEmpty()) return false;
  const a = guess.getSize(new THREE.Vector3()).length();
  const b = real.getSize(new THREE.Vector3()).length();
  if (!a || b / a > 1.25 || b / a < 0.75) return true;
  return guess.getCenter(new THREE.Vector3()).distanceTo(real.getCenter(new THREE.Vector3())) > b * 0.2;
}

// Web Workers that prepare the mesh files: a few at once (fewer on small phones), one file each
// at a time, so the files arrive one by one and draw as they come.
function workerCount(files: number) {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(4, cores - 1, files));
}
const newWorker = () => new Worker(new URL("./meshWorker.ts", import.meta.url), { type: "module" });

// Every file came in or failed (`failed`: their studio indexes), or the load was cancelled.
export type Loaded = { cancelled: boolean; failed: number[] };
export type Loading = {
  done: Promise<Loaded>; // never rejects: a failed file is listed in `failed`
  dispose: () => void; // stops the workers
};

// Reads and draws the model's files, adding to `meshes` (in place: every module holds this array)
// under the stage's root. `added(from)` runs after each Part Studio's parts went in, with the index
// of its first mesh. Every geometry made goes into `geometries`, for the viewer to dispose of.
export function loadModel(
  stage: Stage,
  model: ViewerModel,
  looks: Looks,
  out: { meshes: PartMesh[]; geometries: THREE.BufferGeometry[] },
  on: { progress: (done: number, total: number) => void; added: (from: number) => void },
  cancelled: () => boolean,
): Loading {
  const { root } = stage;
  const { meshes, geometries } = out;
  const jobs = model.studios.flatMap((url, s) => (url ? [{ s, url: new URL(url, location.href).href, key: model.keys?.[s] ?? null }] : []));
  const total = model.studios.length;
  let done = total - jobs.length; // files the model doesn't use here count as done
  on.progress(done, total);

  // Each studio's placements, grouped by (subsystem, part), ready for its file.
  const byStudio = new Map<number, Map<string, { partId: string; g: number; items: ViewerModel["placements"] }>>();
  for (const p of model.placements) {
    const partId = p.k.slice(p.k.lastIndexOf(":") + 1);
    const groups = byStudio.get(p.s) ?? new Map();
    const id = `${p.g ?? 0}|${partId}`;
    const group = groups.get(id) ?? { partId, g: p.g ?? 0, items: [] };
    group.items.push(p);
    groups.set(id, group);
    byStudio.set(p.s, groups);
  }
  // Topology (faces, edges, corners for measuring) is worked out after the drawing, in the same
  // worker, and kept on each geometry as userData.topology.
  const geometriesOf = new Map<number, THREE.BufferGeometry[]>();

  const draw = (s: number, shapes: Shape[]) => {
    const own: THREE.BufferGeometry[] = [];
    const shapeOf = new Map<string, { geometry: THREE.BufferGeometry; edges: Float32Array; look?: Shape["appearance"] }>();
    for (const sh of shapes) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(sh.positions, 3));
      g.setAttribute("normal", new THREE.BufferAttribute(sh.normals, 3));
      g.setIndex(new THREE.BufferAttribute(sh.index, 1));
      g.boundsTree = MeshBVH.deserialize({ version: 1, roots: sh.bvh, index: sh.index, indirectBuffer: null } as SerializedBVH, g, { setIndex: false }) // version: 1 is the current format; the types leave it out;
      geometries.push(g);
      own.push(g);
      shapeOf.set(sh.partId, { geometry: g, edges: sh.edges, look: sh.appearance });
    }
    geometriesOf.set(s, own);
    const from = meshes.length;
    const m = new THREE.Matrix4();
    for (const { partId, g, items } of byStudio.get(s)?.values() ?? []) {
      const shape = shapeOf.get(partId);
      if (!shape) continue;
      const { geometry, edges, look } = shape;
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
    if (meshes.length > from) on.added(from);
  };

  const workers: Worker[] = [];
  // A file that fails (a flaky download on shop Wi-Fi, a worker that dies) is counted and skipped:
  // the rest of the model still loads, and the page offers Retry for the failed ones.
  const failed: number[] = [];
  const done$ = new Promise<Loaded>((resolve) => {
    if (!jobs.length) return resolve({ cancelled: false, failed });
    const queue = [...jobs];
    const ownerOf = new Map<number, Worker>();
    const working = new Map<Worker, number>(); // the studio each worker is on
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      resolve({ cancelled: !ok, failed });
      // Then, quietly: topology for measuring, and the cache clean-up; each worker stops once
      // it has answered all of it.
      if (!ok) return;
      for (const [s, w] of ownerOf) {
        w.postMessage({ kind: "topology", id: s } satisfies WorkerJob);
        pending.set(w, (pending.get(w) ?? 0) + 1);
      }
      const keys = jobs.flatMap((j) => (j.key ? [j.key] : []));
      const sweeper = workers.find((w) => !dead.has(w));
      if (keys.length && sweeper) {
        sweeper.postMessage({ kind: "sweep", keys } satisfies WorkerJob);
        pending.set(sweeper, (pending.get(sweeper) ?? 0) + 1);
      }
      workers.forEach(settle);
    };
    const pending = new Map<Worker, number>();
    const dead = new Set<Worker>();
    const settle = (w: Worker) => !pending.get(w) && w.terminate();
    const next = (w: Worker) => {
      const job = queue.shift();
      if (!job) return;
      working.set(w, job.s);
      w.postMessage({ kind: "studio", id: job.s, url: job.url, key: job.key } satisfies WorkerJob);
    };
    const counted = () => {
      on.progress(++done, total);
      if (done === total) finish(true);
    };
    const fail = (s: number) => {
      failed.push(s);
      counted();
    };
    const spawn = () => {
      const w = newWorker();
      workers.push(w);
      w.onerror = (e) => {
        e.preventDefault?.();
        dead.add(w);
        w.terminate();
        if (finished) return;
        // Its file counts as failed; a fresh worker carries on with the queue.
        const s = working.get(w);
        working.delete(w);
        if (s !== undefined) fail(s);
        if (!finished && queue.length) next(spawn());
      };
      w.onmessage = (e: MessageEvent<WorkerReply>) => {
        const msg = e.data;
        if (msg.kind === "topology" || msg.kind === "swept") {
          if (msg.kind === "topology") geometriesOf.get(msg.id)?.forEach((g, i) => (g.userData.topology = msg.topology[i]));
          pending.set(w, (pending.get(w) ?? 1) - 1);
          return settle(w);
        }
        if (finished) return;
        if (cancelled()) return finish(false);
        working.delete(w);
        if (msg.kind === "failed") fail(msg.id);
        else {
          ownerOf.set(msg.id, w);
          draw(msg.id, msg.shapes);
          counted();
        }
        if (!finished) next(w);
      };
      return w;
    };
    for (let i = 0; i < workerCount(jobs.length); i++) next(spawn());
  });
  return {
    done: done$,
    dispose: () => workers.forEach((w) => w.terminate()),
  };
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
