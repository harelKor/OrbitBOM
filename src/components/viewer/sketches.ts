// A Basepart's Geometry sketches in the 3D view (Harel, 2026-11-12): drawn where Onshape draws
// them, shown and hidden with Shift+H, isolated like parts, and picked for measuring. Each sketch
// is a PartMesh with no faces (types.ts): its copy sits at identity (its points are moved to where
// the sketch is when loaded), its lines and points are children (hidden with it), and its
// topology (src/lib/model/sketch.ts) gives picking and measuring its edges and corners.
import * as THREE from "three";
import { sketchKey, sketchTopology, type Sketch, type SketchFile } from "@/lib/model/sketch";
import type { Stage } from "./stage";
import type { PartMesh, ViewerModel } from "./types";

const LINE = 0x3d7bff; // a sketch's lines: a sketch blue that reads on the light and dark backgrounds
export const isSketch = (pm: PartMesh) => !!pm.sketch;

// A copy hidden with Y is drawn at no size: its lines (not instanced) go with it.
const shown = (mesh: THREE.InstancedMesh) => {
  const a = mesh.instanceMatrix.array;
  return a[0] !== 0 || a[5] !== 0 || a[10] !== 0;
};

// Row-major 4×4 (Onshape's, as placements are) applied to x, y, z triples.
function moved(p: number[], t: number[]): number[] {
  const out = new Array<number>(p.length);
  for (let i = 0; i + 2 < p.length; i += 3) {
    const [x, y, z] = [p[i], p[i + 1], p[i + 2]];
    out[i] = t[0] * x + t[1] * y + t[2] * z + t[3];
    out[i + 1] = t[4] * x + t[5] * y + t[6] * z + t[7];
    out[i + 2] = t[8] * x + t[9] * y + t[10] * z + t[11];
  }
  return out;
}
const placeSketch = (s: Sketch, t: number[]): Sketch => ({ ...s, entities: s.entities.map((e) => ({ ...e, p: moved(e.p, t) })), points: moved(s.points, t) });

// An entity's points as line pieces (a closed one back to its start).
function segments(s: Sketch, construction: boolean): number[] {
  const out: number[] = [];
  for (const e of s.entities) {
    if (!!e.c !== construction) continue;
    const n = e.p.length / 3;
    for (let i = 0; i + 1 < n; i++) out.push(...e.p.slice(i * 3, i * 3 + 6));
    if (e.closed && n > 2) out.push(...e.p.slice((n - 1) * 3, n * 3), ...e.p.slice(0, 3));
  }
  return out;
}

async function readFile(url: string): Promise<SketchFile | null> {
  const res = await fetch(new URL(url, location.href).href);
  if (!res.ok) return null;
  const text = await new Response(res.body!.pipeThrough(new DecompressionStream("gzip"))).text();
  const file = JSON.parse(text) as SketchFile;
  return file?.v === 1 && Array.isArray(file.sketches) ? file : null;
}

export type SketchLoading = { done: Promise<void>; dispose: () => void };

// Reads the model's sketch files and adds a PartMesh per sketch to `meshes` under the stage's
// root; `added` runs once they're in. A file that fails is left out (the parts still draw).
export function loadSketches(stage: Stage, model: ViewerModel, out: { meshes: PartMesh[]; geometries: THREE.BufferGeometry[] }, on: { added: () => void }, cancelled: () => boolean): SketchLoading {
  const files = (model.sketches ?? []).filter((s) => s.url);
  const looks = {
    none: new THREE.MeshBasicMaterial({ visible: false }),
    line: new THREE.LineBasicMaterial({ color: LINE }),
    construction: new THREE.LineBasicMaterial({ color: LINE, transparent: true, opacity: 0.4 }),
    dot: new THREE.PointsMaterial({ color: LINE, size: 5, sizeAttenuation: false }),
  };
  const sketchMeshes: THREE.InstancedMesh[] = [];
  const sync = () => {
    for (const mesh of sketchMeshes) {
      const on = shown(mesh);
      for (const c of mesh.children) c.visible = on;
    }
  };
  stage.beforeRender.push(sync);

  const add = (placed: Sketch, g: number, owner: string) => {
    const { meshes, geometries } = out;
    const all = [...placed.entities.flatMap((e) => e.p), ...placed.points];
    if (!all.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(all, 3));
    geometry.setIndex([]); // no faces: nothing drawn, nothing hit by a ray
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.topology = sketchTopology(placed);
    geometries.push(geometry);
    const mesh = new THREE.InstancedMesh(geometry, looks.none, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    const child = (obj: THREE.LineSegments | THREE.Points) => {
      obj.frustumCulled = false;
      obj.raycast = () => {};
      obj.renderOrder = 5;
      geometries.push(obj.geometry);
      mesh.add(obj);
    };
    const lines = segments(placed, false);
    if (lines.length) child(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(lines, 3)), looks.line));
    const faint = segments(placed, true);
    if (faint.length) child(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(faint, 3)), looks.construction));
    if (placed.points.length) child(new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(placed.points, 3)), looks.dot));
    stage.root.add(mesh);
    sketchMeshes.push(mesh);
    meshes.push({ mesh, keys: [sketchKey(owner, placed.id)], g, sketch: { name: placed.name } });
  };

  const done = (async () => {
    if (!files.length) return;
    const read = await Promise.all(files.map((f) => readFile(f.url!).catch(() => null)));
    if (cancelled()) return;
    read.forEach((file, i) => {
      const f = files[i];
      for (const s of file?.sketches ?? []) add(placeSketch(s, f.t), f.g ?? -1, f.owner);
    });
    stage.root.updateMatrixWorld(true);
    if (sketchMeshes.length) on.added();
  })();

  return {
    done,
    dispose: () => {
      const i = stage.beforeRender.indexOf(sync);
      if (i >= 0) stage.beforeRender.splice(i, 1);
      Object.values(looks).forEach((m) => m.dispose());
    },
  };
}

// Shift+H: every sketch shown or hidden (Harel, 2026-11-12), for this viewer while the mouse is
// over it or it was the last thing touched, not while typing or with another window open.
export function sketchKeys(el: HTMLElement, toggle: () => boolean): () => void {
  let over = false;
  let focused = false;
  const onEnter = () => (over = true);
  const onLeave = () => (over = false);
  const onAnyDown = (e: PointerEvent) => (focused = el.contains(e.target as Node));
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== "KeyH" || !e.shiftKey || (!over && !focused) || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]")) return;
    if ([...document.querySelectorAll("dialog[open]")].some((d) => !d.contains(el))) return;
    if (toggle()) e.preventDefault();
  };
  el.addEventListener("pointerenter", onEnter);
  el.addEventListener("pointerleave", onLeave);
  window.addEventListener("pointerdown", onAnyDown, true);
  window.addEventListener("keydown", onKey);
  return () => {
    el.removeEventListener("pointerenter", onEnter);
    el.removeEventListener("pointerleave", onLeave);
    window.removeEventListener("pointerdown", onAnyDown, true);
    window.removeEventListener("keydown", onKey);
  };
}
