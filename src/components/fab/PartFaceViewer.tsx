"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { decodeMeshes } from "@/lib/model/mesh";

type V3 = [number, number, number];

// The face on the sheet, and the rest of the part, in the layout window's preview.
const DOWN_COLOR = new THREE.Color("#22c55e"); // green: easy to see against the grey part
const PART_COLOR = new THREE.Color("#9aa1ad");
const HOVER_COLOR = new THREE.Color("#86efac");
const FLAT_COS = 0.999;

// One part from the batch's saved mesh file (the same file Auto Layout read: no Onshape calls),
// lying on its face down, which is green. A click on another flat face (not a curved or tiny one)
// makes it the face down; `onPick` gets its outward normal in Part Studio axes.
export function PartFaceViewer({ meshUrl, onshapePartId, down, onPick, busy }: { meshUrl: string; onshapePartId: string; down: V3; onPick: (down: V3) => void; busy: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pick = useRef(onPick);
  const blocked = useRef(busy);
  const latestDown = useRef(down);
  // Re-lays the part on a new face down without reloading the file (set once the scene is up).
  const current = useRef<((d: V3) => void) | null>(null);
  useEffect(() => {
    pick.current = onPick;
    blocked.current = busy;
    latestDown.current = down;
  });

  useEffect(() => {
    const el = host.current!;
    let disposed = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Sized by its box (CSS), drawn at the box's size (resize below).
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445066, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.001, 100);
    // As the robot viewer (ModelCanvas): left or right drag turns, middle drag moves, the wheel
    // zooms, and it stops where the drag stops (no damping glide).
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    // A middle click would start the browser's auto-scroll; stop it.
    const noAutoScroll = (e: MouseEvent) => e.button === 1 && e.preventDefault();
    renderer.domElement.addEventListener("mousedown", noAutoScroll);
    let frame = 0;
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(loop);
    };
    loop();

    // Per triangle: its normal (Part Studio axes) and which flat face it belongs to.
    let mesh: THREE.Mesh | null = null;
    let faceOf: Int32Array = new Int32Array();
    let faces: { n: V3; tris: number[] }[] = [];
    let downFace = -1;
    let hover = -1;
    const paint = () => {
      if (!mesh) return;
      const color = mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
      for (let t = 0; t < faceOf.length; t++) {
        const f = faceOf[t];
        const c = f >= 0 && f === downFace ? DOWN_COLOR : f >= 0 && f === hover ? HOVER_COLOR : PART_COLOR;
        for (let k = 0; k < 3; k++) color.setXYZ(t * 3 + k, c.r, c.g, c.b);
      }
      color.needsUpdate = true;
    };

    (async () => {
      try {
        const res = await fetch(meshUrl);
        if (!res.ok || !res.body) throw new Error(`model file ${res.status}`);
        const buf = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
        const m = decodeMeshes(buf).find((x) => x.partId === onshapePartId);
        if (disposed) return;
        if (!m) throw new Error("This part isn't in its saved 3D file.");
        const P = m.positions;
        const I = m.indices;
        const nt = Math.floor(I.length / 3);
        const pos = new Float32Array(nt * 9);
        const normals: V3[] = [];
        const levels: number[] = [];
        const areas: number[] = [];
        for (let t = 0; t < nt; t++) {
          const [a, b, c] = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]];
          for (const [k, i] of [a, b, c].entries()) pos.set([P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], t * 9 + k * 3);
          const ab = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
          const ac = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
          const n: V3 = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
          const len = Math.hypot(...n) || 1;
          normals.push([n[0] / len, n[1] / len, n[2] / len]);
          areas.push(len / 2);
          levels.push((normals[t][0] * P[a * 3] + normals[t][1] * P[a * 3 + 1] + normals[t][2] * P[a * 3 + 2]) * 1000);
        }
        // Flat faces: triangles facing the same way in the same plane (0.05 mm). A face smaller
        // than 2% of the part's surface (a facet of a hole, a chamfer) can't be picked.
        const total = areas.reduce((s, a) => s + a, 0);
        faceOf = new Int32Array(nt).fill(-1);
        const all: { n: V3; level: number; tris: number[]; area: number }[] = [];
        for (let t = 0; t < nt; t++) {
          const n = normals[t];
          let f = all.findIndex((x) => x.n[0] * n[0] + x.n[1] * n[1] + x.n[2] * n[2] > FLAT_COS && Math.abs(x.level - levels[t]) < 0.05);
          if (f < 0) f = all.push({ n, level: levels[t], tris: [], area: 0 }) - 1;
          all[f].tris.push(t);
          all[f].area += areas[t];
        }
        faces = [];
        for (const f of all) {
          if (f.area < total * 0.02) continue;
          const id = faces.push({ n: f.n, tris: f.tris }) - 1;
          for (const t of f.tris) faceOf[t] = id;
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(nt * 9), 3));
        geometry.computeVertexNormals();
        // Centred on its own middle, so laying it on another face turns it in place.
        geometry.computeBoundingBox();
        const centre = geometry.boundingBox!.getCenter(new THREE.Vector3());
        geometry.translate(-centre.x, -centre.y, -centre.z);
        mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.15, side: THREE.DoubleSide }));
        const holder = new THREE.Group();
        holder.add(mesh);
        scene.add(holder);
        setDown(latestDown.current);
        // Frame it: the same distance whichever face it lies on.
        const size = geometry.boundingBox!.getSize(new THREE.Vector3()).length() || 0.1;
        const mid = new THREE.Vector3();
        controls.target.copy(mid);
        camera.position.copy(mid).add(new THREE.Vector3(0.7, 0.9, 1).normalize().multiplyScalar(size * 1.6));
        camera.near = size / 100;
        camera.far = size * 20;
        camera.updateProjectionMatrix();
        setLoading(false);
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : "The 3D shape didn't load.");
          setLoading(false);
        }
      }
    })();

    // Lays the part on the face whose outward normal is `d` (it points down on screen).
    function setDown(d: V3) {
      if (!mesh) return;
      downFace = faces.findIndex((f) => f.n[0] * d[0] + f.n[1] * d[1] + f.n[2] * d[2] > FLAT_COS);
      // The outermost of the faces facing that way is the one on the sheet.
      if (downFace >= 0) {
        const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
        const level = (f: number) => {
          const t = faces[f].tris[0];
          return faces[f].n[0] * pos.getX(t * 3) + faces[f].n[1] * pos.getY(t * 3) + faces[f].n[2] * pos.getZ(t * 3);
        };
        faces.forEach((f, i) => {
          if (f.n[0] * d[0] + f.n[1] * d[1] + f.n[2] * d[2] > FLAT_COS && level(i) > level(downFace)) downFace = i;
        });
      }
      mesh.parent!.quaternion.setFromUnitVectors(new THREE.Vector3(...d).normalize(), new THREE.Vector3(0, -1, 0));
      paint();
    }
    current.current = setDown;

    // Hover shows a pickable face; a click (not a drag) picks it.
    const ray = new THREE.Raycaster();
    const faceAt = (e: PointerEvent) => {
      if (!mesh) return -1;
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObject(mesh)[0];
      return hit?.faceIndex != null ? faceOf[hit.faceIndex] : -1;
    };
    let start: [number, number] | null = null;
    // Only a left click (or a tap) picks; right and middle drags turn and move the view.
    const onDown = (e: PointerEvent) => (start = e.button === 0 ? [e.clientX, e.clientY] : null);
    const onMove = (e: PointerEvent) => {
      if (e.buttons) return;
      const f = faceAt(e);
      const next = f === downFace ? -1 : f;
      if (next !== hover) {
        hover = next;
        renderer.domElement.style.cursor = hover >= 0 ? "pointer" : "";
        paint();
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5 || blocked.current) return;
      const f = faceAt(e);
      if (f >= 0 && f !== downFace) pick.current(faces[f].n);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerup", onUp);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("mousedown", noAutoScroll);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerup", onUp);
      mesh?.geometry.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
    };
    // The face down changes through `current`, without reloading the file.
  }, [meshUrl, onshapePartId]);

  // A new face down (Flip, a pick saved, Automatic) re-lays the part in place.
  useEffect(() => {
    current.current?.(down);
  }, [down]);

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0 touch-none" />
      {(loading || error) && (
        <p className={`absolute inset-0 flex items-center justify-center p-4 text-center text-sm ${error ? "text-rose-500" : "text-muted"}`}>{error ?? "Loading the 3D shape…"}</p>
      )}
    </div>
  );
}
