// Part, system and robot pictures drawn in the browser from the 3D model's own meshes (Harel,
// 2026-11-11): Onshape's thumbnails cost one call each, and drawing them here makes every
// picture look like the 3D view. The server says which pictures are missing or out of date
// (GET /api/robots/<id>/pictures, a database read); each is drawn at Onshape's isometric view,
// lit like the viewer, and sent back in small batches (POST, stored in R2). No Onshape calls.
import * as THREE from "three";
import { edgePositions } from "@/lib/model/edges";
import { decodeMeshes, type Mesh } from "@/lib/model/mesh";
import type { ModelPlacement } from "@/lib/model/build";
import { VIEWS } from "./camera";
import { meshFile } from "./meshCache";
import { EDGE, PLAIN, srgb } from "./paint";

export type PictureJobs = {
  studios: (string | null)[]; // signed links to the model's Part Studio files
  keys: string[];
  placements: ModelPlacement[];
  // `rev`: the picture the part has now, named by its mesh (meshRev); a part whose mesh is the
  // same (another part of its Part Studio changed) keeps it and sends no image.
  parts: { id: string; s: number; partId: string; rev: string | null }[];
  systems: { id: string; g: number; rev: string }[];
  robot: { rev: string } | null;
};

const SIZE = 300;
const BATCH = 12;
// Assemblies with more parts than this are drawn without face borders: they'd be a grey smudge
// at this size anyway, and quicker without.
const EDGE_LIMIT = 400;

// Draws and uploads what the server asks for. Returns how many pictures were stored. Never
// throws: pictures are a nicety, the 3D model is already built.
export async function drawPictures(robotId: string, systemId?: string, onProgress?: (done: number, total: number) => void): Promise<number> {
  try {
    const res = await fetch(`/api/robots/${robotId}/pictures${systemId ? `?system=${systemId}` : ""}`);
    if (!res.ok) return 0;
    const jobs = (await res.json()) as PictureJobs | null;
    if (!jobs) return 0;
    const total = jobs.parts.length + jobs.systems.length + (jobs.robot ? 1 : 0);
    if (!total) return 0;
    const painter = createPainter();
    const files = studioFiles(jobs);
    let stored = 0;
    let batch = new FormData();
    let inBatch = 0;
    const flush = async () => {
      if (!inBatch) return;
      const r = await fetch(`/api/robots/${robotId}/pictures`, { method: "POST", body: batch }).catch(() => null);
      if (r?.ok) stored += ((await r.json().catch(() => null)) as { stored?: number } | null)?.stored ?? 0;
      batch = new FormData();
      inBatch = 0;
    };
    const add = async (name: string, png: Blob | null) => {
      if (png) {
        batch.append(name, png, `${name}.png`);
        inBatch++;
      }
      onProgress?.(++done, total);
      if (inBatch >= BATCH) await flush();
    };
    let done = 0;
    try {
      for (const job of jobs.parts) {
        const meshes = (await files(job.s).catch(() => null))?.get(job.partId);
        const rev = meshes ? await meshRev(meshes) : null;
        if (rev && rev === job.rev) {
          batch.append(`same:${job.id}`, "1");
          inBatch++;
          onProgress?.(++done, total);
          continue;
        }
        await add(`part:${job.id}:${rev}`, meshes ? await painter.draw([{ meshes, matrix: null }], true) : null);
      }
      for (const job of jobs.systems) {
        await add(`system:${job.id}:${job.rev}`, await painter.draw(await placed(jobs, files, (p) => p.g === job.g), true));
      }
      if (jobs.robot) await add(`robot:${jobs.robot.rev}`, await painter.draw(await placed(jobs, files, () => true), true));
      await flush();
    } finally {
      painter.dispose();
    }
    return stored;
  } catch (err) {
    console.warn("Pictures stopped", err);
    return 0;
  }
}

// A part picture's name: "g" and a hash of the part's own mesh, so it changes only when this part's
// shape or colour does (drawings and plate DXFs compare it to see whether they're out of date).
export async function meshRev(meshes: Mesh[]): Promise<string> {
  const parts: Uint8Array[] = [];
  for (const m of meshes) {
    parts.push(new Uint8Array(m.positions.buffer, m.positions.byteOffset, m.positions.byteLength));
    parts.push(new Uint8Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength));
    if (m.appearance) parts.push(new TextEncoder().encode(JSON.stringify(m.appearance)));
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.byteLength;
  }
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
  return `g${[...hash.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// Each Part Studio file once, decoded into its parts' meshes.
function studioFiles(jobs: PictureJobs) {
  const loaded = new Map<number, Promise<Map<string, Mesh[]>>>();
  return (s: number) => {
    let file = loaded.get(s);
    if (!file) {
      file = (async () => {
        const url = jobs.studios[s];
        if (!url) throw new Error("No link to the model file.");
        const gz = await meshFile(url, jobs.keys[s] ?? null);
        const buf = await new Response(new Response(gz).body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
        const byPart = new Map<string, Mesh[]>();
        for (const m of decodeMeshes(buf)) byPart.set(m.partId, [...(byPart.get(m.partId) ?? []), m]);
        return byPart;
      })();
      loaded.set(s, file);
    }
    return file;
  };
}

type Item = { meshes: Mesh[]; matrix: THREE.Matrix4 | null };

async function placed(jobs: PictureJobs, files: (s: number) => Promise<Map<string, Mesh[]>>, keep: (p: ModelPlacement) => boolean): Promise<Item[]> {
  const items: Item[] = [];
  for (const p of jobs.placements) {
    if (!keep(p)) continue;
    const partId = p.k.slice(p.k.lastIndexOf(":") + 1);
    const meshes = (await files(p.s).catch(() => null))?.get(partId);
    if (!meshes) continue;
    const t = p.t;
    items.push({ meshes, matrix: new THREE.Matrix4().set(t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], t[9], t[10], t[11], t[12], t[13], t[14], t[15]) });
  }
  return items;
}

// One small WebGL canvas for every picture, lit like the viewer's stage (stage.ts).
function createPainter() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  const world = new THREE.Scene();
  world.add(new THREE.HemisphereLight(0xffffff, 0x5d6372, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 0.5);
  sun.position.set(2, 4, 3);
  world.add(sun);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 1000);
  const headlight = new THREE.DirectionalLight(0xffffff, 2.1);
  headlight.position.set(-0.4, 0.6, 0);
  headlight.target.position.set(0, 0, -1);
  camera.add(headlight, headlight.target);
  world.add(camera);
  const out = document.createElement("canvas");
  out.width = out.height = SIZE;
  const ctx = out.getContext("2d")!;
  const geometries = new Map<Mesh, { faces: THREE.BufferGeometry; edges: THREE.BufferGeometry }>();
  const geometryOf = (m: Mesh) => {
    let g = geometries.get(m);
    if (!g) {
      const faces = new THREE.BufferGeometry();
      faces.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
      faces.setIndex(new THREE.BufferAttribute(m.indices, 1));
      faces.computeVertexNormals();
      const edges = new THREE.BufferGeometry();
      edges.setAttribute("position", new THREE.BufferAttribute(edgePositions(m.positions, m.indices), 3));
      g = { faces, edges };
      geometries.set(m, g);
    }
    return g;
  };
  const materials = new Map<string, THREE.Material>();
  const materialOf = (m: Mesh) => {
    const color = m.appearance ? srgb(m.appearance.color) : new THREE.Color(PLAIN);
    const opacity = m.appearance?.opacity ?? 1;
    const key = `${color.getHexString()}:${opacity}`;
    let mat = materials.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, transparent: opacity < 1, opacity, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      materials.set(key, mat);
    }
    return mat;
  };
  const lineMaterial = new THREE.LineBasicMaterial({ color: EDGE });

  return {
    async draw(items: Item[], borders: boolean): Promise<Blob | null> {
      if (!items.length) return null;
      const root = new THREE.Group();
      root.rotation.x = -Math.PI / 2; // Onshape is Z-up
      const withEdges = borders && items.length <= EDGE_LIMIT;
      for (const { meshes, matrix } of items) {
        for (const m of meshes) {
          const { faces, edges } = geometryOf(m);
          const mesh = new THREE.Mesh(faces, materialOf(m));
          if (matrix) mesh.applyMatrix4(matrix);
          root.add(mesh);
          if (withEdges) {
            const lines = new THREE.LineSegments(edges, lineMaterial);
            if (matrix) lines.applyMatrix4(matrix);
            root.add(lines);
          }
        }
      }
      world.add(root);
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) {
        world.remove(root);
        return null;
      }
      // Onshape's isometric view, framed to the part's bounding sphere with a small margin.
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const r = sphere.radius * 1.08 || 0.01;
      const dir = new THREE.Vector3(...VIEWS.iso).normalize();
      camera.left = camera.bottom = -r;
      camera.right = camera.top = r;
      camera.near = r * 0.01;
      camera.far = r * 10;
      camera.position.copy(sphere.center).addScaledVector(dir, r * 4);
      camera.up.set(0, 1, 0);
      camera.lookAt(sphere.center);
      camera.updateProjectionMatrix();
      renderer.render(world, camera);
      world.remove(root);
      // The viewer's soft background, near white to a light blue-grey.
      const bg = ctx.createLinearGradient(0, 0, 0, SIZE);
      bg.addColorStop(0, "#f7f8fa");
      bg.addColorStop(1, "#d9dfe8");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.drawImage(renderer.domElement, 0, 0, SIZE, SIZE);
      return new Promise((resolve) => out.toBlob((b) => resolve(b), "image/png"));
    },
    dispose() {
      for (const g of geometries.values()) {
        g.faces.dispose();
        g.edges.dispose();
      }
      for (const m of materials.values()) m.dispose();
      lineMaterial.dispose();
      renderer.dispose();
    },
  };
}
