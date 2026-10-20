"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { decodeMeshes, type Mesh } from "@/lib/model/mesh";

export type ViewerModel = { studios: (string | null)[]; placements: { s: number; k: string; t: number[] }[] };

const PLAIN = "#9aa1ad";
const UNKNOWN = "#b8bec9"; // placed in CAD but not on the BOM

async function loadStudio(url: string): Promise<Mesh[]> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model file ${res.status}`);
  const buf = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  return decodeMeshes(buf);
}

// The three.js stage: one instanced mesh per part shape, coloured by status (or plain), with
// the located part lit up in the accent colour and everything else faded.
export function ModelCanvas({
  model,
  colors,
  mode,
  locateKey,
  onLocated,
}: {
  model: ViewerModel;
  colors: Map<string, string>; // part key → status colour
  mode: "status" | "plain";
  locateKey: string | null;
  onLocated: (found: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  // Recolours the parts and frames the located one; true when it is in the model.
  const scene = useRef<{ paint: (colors: Map<string, string>, mode: "status" | "plain", locateKey: string | null) => boolean } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>({ done: 0, total: model.studios.length });
  const [error, setError] = useState<string | null>(null);

  // Scene, camera, controls, and the model's geometry.
  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const world = new THREE.Scene();
    world.add(new THREE.HemisphereLight(0xffffff, 0x8a91a2, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    world.add(sun);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.005, 200);
    camera.position.set(1.4, 1, 1.4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2; // Onshape is Z-up
    world.add(root);

    const render = () => renderer.render(world, camera);
    controls.addEventListener("change", render);
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const fit = (box: THREE.Box3) => {
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.02);
      const dir = camera.position.clone().sub(controls.target).normalize();
      if (!dir.lengthSq()) dir.set(1, 0.7, 1).normalize();
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(dir, radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)));
      controls.update();
      render();
    };

    const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 });
    const geometries: THREE.BufferGeometry[] = [];
    const meshes: { mesh: THREE.InstancedMesh; keys: string[] }[] = [];
    const paint = (colors: Map<string, string>, mode: "status" | "plain", locateKey: string | null) => {
      const accent = getComputedStyle(el).getPropertyValue("--color-accent").trim() || "#0000cc";
      const highlight = new THREE.Color(accent);
      const faded = new THREE.Color(PLAIN).lerp(new THREE.Color("#ffffff"), 0.35);
      const box = new THREE.Box3();
      const piece = new THREE.Box3();
      const m = new THREE.Matrix4();
      let found = false;
      for (const { mesh, keys } of meshes) {
        keys.forEach((k, i) => {
          let color: THREE.Color;
          if (locateKey && k === locateKey) {
            color = highlight;
            found = true;
            mesh.getMatrixAt(i, m);
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            box.union(piece.copy(mesh.geometry.boundingBox!).applyMatrix4(m.premultiply(root.matrixWorld)));
          } else if (locateKey) {
            color = faded;
          } else {
            color = new THREE.Color(mode === "status" ? (colors.get(k) ?? UNKNOWN) : PLAIN);
          }
          mesh.setColorAt(i, color);
        });
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      if (found) fit(box);
      render();
      return found;
    };
    scene.current = { paint };

    (async () => {
      const shapes: Map<string, THREE.BufferGeometry>[] = [];
      let done = 0;
      const queue = model.studios.map((url, i) => ({ url, i }));
      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const byPart = new Map<string, THREE.BufferGeometry>();
          if (job.url) {
            for (const m of await loadStudio(job.url)) {
              const g = new THREE.BufferGeometry();
              g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
              g.setIndex(new THREE.BufferAttribute(m.indices, 1));
              g.computeVertexNormals();
              geometries.push(g);
              byPart.set(m.partId, g);
            }
          }
          shapes[job.i] = byPart;
          if (!disposed) setProgress({ done: ++done, total: model.studios.length });
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      if (disposed) return;

      // One instanced mesh per (Part Studio, part).
      const groups = new Map<string, { geometry: THREE.BufferGeometry; items: typeof model.placements }>();
      for (const p of model.placements) {
        const partId = p.k.slice(p.k.lastIndexOf(":") + 1);
        const geometry = shapes[p.s]?.get(partId);
        if (!geometry) continue;
        const id = `${p.s}|${partId}`;
        const group = groups.get(id) ?? { geometry, items: [] };
        group.items.push(p);
        groups.set(id, group);
      }
      const m = new THREE.Matrix4();
      for (const { geometry, items } of groups.values()) {
        const mesh = new THREE.InstancedMesh(geometry, material, items.length);
        items.forEach((p, i) => {
          const t = p.t;
          m.set(t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], t[9], t[10], t[11], t[12], t[13], t[14], t[15]);
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(i, new THREE.Color(PLAIN));
        });
        mesh.computeBoundingSphere();
        root.add(mesh);
        meshes.push({ mesh, keys: items.map((p) => p.k) });
      }
      root.updateMatrixWorld(true);
      fit(new THREE.Box3().setFromObject(root));
      setProgress(null);
    })().catch(() => !disposed && setError("The 3D model couldn't load. Try reloading the page."));

    return () => {
      disposed = true;
      observer.disconnect();
      controls.dispose();
      geometries.forEach((g) => g.dispose());
      meshes.forEach(({ mesh }) => mesh.dispose());
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.current = null;
    };
  }, [model]);

  // Colours and Locate.
  const loaded = progress === null;
  useEffect(() => {
    if (loaded) onLocated(scene.current?.paint(colors, mode, locateKey) ?? false);
  }, [loaded, colors, mode, locateKey, onLocated]);

  return (
    <div ref={host} className="absolute inset-0">
      {progress && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted tabular-nums">
          Loading the robot… {progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%
        </div>
      )}
      {error && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">{error}</div>}
    </div>
  );
}
