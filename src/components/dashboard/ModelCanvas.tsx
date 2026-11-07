"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { decodeMeshes, type Appearance, type Mesh } from "@/lib/model/mesh";

export type ViewerModel = {
  studios: (string | null)[];
  placements: { s: number; k: string; t: number[]; g?: number }[];
  groups?: { systemIds: string[]; name: string }[]; // subsystems, by placement g
};

const PLAIN = "#9aa1ad"; // a part with no Onshape appearance in its file
const UNKNOWN = "#b8bec9"; // placed in CAD but not on the BOM
const LOCATED = "#22ff5e"; // the located part: bright green, through a see-through robot
const HOVER = "#6f9bff"; // a light blue wash over the part under the mouse, like Onshape's
const GONE = new THREE.Matrix4().makeScale(0, 0, 0); // a hidden instance: drawn at no size, never hit

// A part instance hidden with Y: its mesh, its index there, and its BOM key.
type Gone = { m: number; i: number; key: string };

async function loadStudio(url: string): Promise<Mesh[]> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model file ${res.status}`);
  const buf = await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  return decodeMeshes(buf);
}

export type ViewerMode = "status" | "cad";

// The three.js stage: one instanced mesh per part shape, coloured by status (or CAD: Onshape's
// own appearance, see-through parts included, lit by a studio environment like Onshape's). While
// locating, the robot turns see-through and the located part is drawn solid in bright green.
// Like Onshape: right drag rotates, middle drag moves, the wheel zooms (left drag also rotates,
// for touchpads). With a mouse, the part under it is washed in light blue; Y hides it, Shift+Y
// brings back the last one hidden (again for the one before), and a compact list on the left
// shows the hidden parts, a click there brings one back (Harel, 2026-11-07).
export function ModelCanvas({
  model,
  colors,
  mode,
  locateKey,
  onLocated,
  hidden,
  selectedKey,
  onPick,
  onOpen,
  names,
  panelLeft,
}: {
  model: ViewerModel;
  colors: Map<string, string>; // part key → status colour
  mode: ViewerMode;
  locateKey: string | null;
  onLocated: (found: boolean) => void;
  hidden?: Set<number>; // subsystem groups not drawn
  selectedKey?: string | null; // a part picked with a click: drawn in bright green
  onPick?: (key: string | null) => void; // a click on a part (its key) or on empty space (null)
  onOpen?: (key: string) => void; // a double-click on a part
  names?: Map<string, string>; // part key -> its name, for the hidden parts list
  panelLeft?: number; // px from the left for the hidden parts list, past the viewer's own panels
}) {
  const host = useRef<HTMLDivElement>(null);
  // Recolours the parts and frames the located one; true when it is in the model.
  const scene = useRef<{
    paint: (colors: Map<string, string>, mode: ViewerMode, locateKey: string | null) => boolean;
    hide: (hidden: Set<number>) => void;
    select: (key: string | null) => void;
    show: (gone: Gone[]) => void;
  } | null>(null);
  const [gone, setGone] = useState<Gone[]>([]);
  const pick = useRef(onPick);
  const openPart = useRef(onOpen);
  useEffect(() => {
    pick.current = onPick;
    openPart.current = onOpen;
  }, [onPick, onOpen]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>({ done: 0, total: model.studios.length });
  const [error, setError] = useState<string | null>(null);
  const hiddenAtLoad = useRef(hidden);
  useEffect(() => {
    hiddenAtLoad.current = hidden;
  }, [hidden]);

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
    // CAD mode's studio reflections, so metal parts read as metal.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    world.environmentIntensity = 0.7;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.005, 200);
    camera.position.set(1.4, 1, 1.4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    // A middle click on a link-free canvas still starts the browser's auto-scroll; stop it.
    const noAutoScroll = (e: MouseEvent) => e.button === 1 && e.preventDefault();
    renderer.domElement.addEventListener("mousedown", noAutoScroll);
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
    const fit = (box: THREE.Box3, minRadius = 0.02) => {
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, minRadius);
      const dir = camera.position.clone().sub(controls.target).normalize();
      if (!dir.lengthSq()) dir.set(1, 0.7, 1).normalize();
      controls.target.copy(center);
      camera.position.copy(center).addScaledVector(dir, radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)));
      controls.update();
      render();
    };

    const material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 });
    const cad = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.35 });
    const ghost = new THREE.MeshStandardMaterial({ roughness: 0.6, transparent: true, opacity: 0.14, depthWrite: false });
    const glow = new THREE.MeshStandardMaterial({ color: LOCATED, emissive: LOCATED, emissiveIntensity: 0.55, roughness: 0.4 });
    const geometries: THREE.BufferGeometry[] = [];
    const meshes: { mesh: THREE.InstancedMesh; keys: string[]; g: number; look?: Appearance }[] = [];
    // Onshape's see-through appearances, one material per opacity.
    const clear = new Map<number, THREE.MeshStandardMaterial>();
    const seeThrough = (opacity: number) => {
      let m = clear.get(opacity);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1, transparent: true, opacity, depthWrite: false });
        clear.set(opacity, m);
      }
      return m;
    };
    const highlights = new THREE.Group();
    const picks = new THREE.Group();
    root.add(highlights, picks);
    const paint = (colors: Map<string, string>, mode: ViewerMode, locateKey: string | null) => {
      highlights.clear();
      world.environment = mode === "cad" && !locateKey ? studio : null;
      const plain = new THREE.Color(PLAIN);
      const box = new THREE.Box3();
      const piece = new THREE.Box3();
      for (const { mesh, keys, look } of meshes) {
        const own = mode === "cad" && look;
        mesh.material = locateKey ? ghost : own && look.opacity < 1 ? seeThrough(look.opacity) : mode === "cad" ? cad : material;
        const onshape = own ? new THREE.Color(...look.color) : plain;
        keys.forEach((k, i) => {
          mesh.setColorAt(i, locateKey ? plain : mode === "status" ? new THREE.Color(colors.get(k) ?? UNKNOWN) : onshape);
          if (k !== locateKey) return;
          // The located part, drawn solid on top of its see-through instance.
          const lit = new THREE.Mesh(mesh.geometry, glow);
          mesh.getMatrixAt(i, lit.matrix);
          lit.matrixAutoUpdate = false;
          highlights.add(lit);
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          box.union(piece.copy(mesh.geometry.boundingBox!).applyMatrix4(lit.matrix.clone().premultiply(root.matrixWorld)));
        });
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      const found = highlights.children.length > 0;
      // Close on the part, with enough of the robot around it to see where it sits.
      if (found) fit(box, new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).length() * 0.2);
      render();
      return found;
    };
    // Hiding a subsystem hides its meshes; the framing stays where it is.
    const hide = (hidden: Set<number>) => {
      for (const { mesh, g } of meshes) mesh.visible = !hidden.has(g);
      render();
    };
    // A clicked part, drawn solid in bright green over its instances (every copy of it).
    const select = (key: string | null) => {
      picks.clear();
      if (key) {
        for (const { mesh, keys } of meshes) {
          keys.forEach((k, i) => {
            if (k !== key) return;
            const lit = new THREE.Mesh(mesh.geometry, glow);
            mesh.getMatrixAt(i, lit.matrix);
            lit.matrixAutoUpdate = false;
            lit.visible = mesh.visible;
            lit.userData.of = mesh;
            picks.add(lit);
          });
        }
      }
      render();
    };
    // The part under the mouse, washed over its own surfaces.
    const hoverLook = new THREE.MeshBasicMaterial({
      color: HOVER,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const hoverLayer = new THREE.Group();
    root.add(hoverLayer);
    let hovered: { m: number; i: number } | null = null;
    const setHover = (h: { m: number; i: number } | null) => {
      if (h?.m === hovered?.m && h?.i === hovered?.i) return;
      hovered = h;
      hoverLayer.clear();
      if (h) {
        const { mesh } = meshes[h.m];
        const lit = new THREE.Mesh(mesh.geometry, hoverLook);
        mesh.getMatrixAt(h.i, lit.matrix);
        lit.matrixAutoUpdate = false;
        hoverLayer.add(lit);
      }
      render();
    };
    // Hidden instances keep their place here and are drawn at no size meanwhile.
    const kept = new Map<string, THREE.Matrix4>();
    let goneList: Gone[] = [];
    let selectedNow: string | null = null;
    const hideOne = (g: Gone) => {
      const { mesh } = meshes[g.m];
      const was = new THREE.Matrix4();
      mesh.getMatrixAt(g.i, was);
      kept.set(`${g.m}:${g.i}`, was);
      mesh.setMatrixAt(g.i, GONE);
      mesh.instanceMatrix.needsUpdate = true;
      goneList = [...goneList, g];
      setGone(goneList);
      setHover(null);
      select(selectedNow);
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
      setGone(goneList);
      select(selectedNow);
    };
    scene.current = { paint, hide, select: (key) => select((selectedNow = key)), show };

    // Left click (not a drag) picks the part under the pointer; a double-click opens it.
    const ray = new THREE.Raycaster();
    const hitAt = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1)), camera);
      const [hit] = ray.intersectObjects(
        meshes.filter((m) => m.mesh.visible).map((m) => m.mesh),
        false,
      );
      const m = hit ? meshes.findIndex((x) => x.mesh === hit.object) : -1;
      return m >= 0 && hit.instanceId !== undefined ? { m, i: hit.instanceId } : null;
    };
    const keyAt = (e: MouseEvent) => {
      const h = hitAt(e);
      return h ? (meshes[h.m].keys[h.i] ?? null) : null;
    };
    // Hover: one ray per frame at most, mouse only, not while dragging.
    let over = false;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      over = true;
      cancelAnimationFrame(frame);
      if (e.pointerType !== "mouse" || e.buttons) return setHover(null);
      frame = requestAnimationFrame(() => setHover(hitAt(e)));
    };
    const onLeave = () => {
      over = false;
      cancelAnimationFrame(frame);
      setHover(null);
    };
    // Y (by key position, so it works on a Hebrew layout too) while the mouse is on the model.
    const onKey = (e: KeyboardEvent) => {
      if (!over || e.code !== "KeyY" || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]")) return;
      if (e.shiftKey) {
        const last = goneList.at(-1);
        if (!last) return;
        show([last]);
      } else {
        if (!hovered) return;
        hideOne({ ...hovered, key: meshes[hovered.m].keys[hovered.i] });
      }
      e.preventDefault();
    };
    renderer.domElement.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("keydown", onKey);
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      if (!down || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      down = null;
      pick.current?.(keyAt(e));
    };
    const onDouble = (e: MouseEvent) => {
      if (e.button !== 0 || !openPart.current) return;
      const key = keyAt(e);
      if (key) openPart.current(key);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("dblclick", onDouble);

    (async () => {
      const shapes: Map<string, { geometry: THREE.BufferGeometry; look?: Appearance }>[] = [];
      let done = 0;
      const queue = model.studios.map((url, i) => ({ url, i }));
      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const byPart = new Map<string, { geometry: THREE.BufferGeometry; look?: Appearance }>();
          if (job.url) {
            for (const m of await loadStudio(job.url)) {
              const g = new THREE.BufferGeometry();
              g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
              g.setIndex(new THREE.BufferAttribute(m.indices, 1));
              g.computeVertexNormals();
              geometries.push(g);
              byPart.set(m.partId, { geometry: g, look: m.appearance });
            }
          }
          shapes[job.i] = byPart;
          if (!disposed) setProgress({ done: ++done, total: model.studios.length });
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      if (disposed) return;

      // One instanced mesh per (subsystem, Part Studio, part).
      const groups = new Map<string, { geometry: THREE.BufferGeometry; look?: Appearance; items: typeof model.placements; g: number }>();
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
      for (const { geometry, look, items, g } of groups.values()) {
        const mesh = new THREE.InstancedMesh(geometry, material, items.length);
        items.forEach((p, i) => {
          const t = p.t;
          m.set(t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7], t[8], t[9], t[10], t[11], t[12], t[13], t[14], t[15]);
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(i, new THREE.Color(PLAIN));
        });
        mesh.computeBoundingSphere();
        root.add(mesh);
        meshes.push({ mesh, keys: items.map((p) => p.k), g, look });
      }
      root.updateMatrixWorld(true);
      // Frame what's shown: a subsystem page starts with only its own subsystem.
      const shown = new THREE.Box3();
      for (const { mesh, g } of meshes) {
        mesh.visible = !hiddenAtLoad.current?.has(g);
        if (mesh.visible) shown.expandByObject(mesh);
      }
      fit(shown);
      setProgress(null);
    })().catch(() => !disposed && setError("The 3D model couldn't load. Try reloading the page."));

    return () => {
      disposed = true;
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("mousedown", noAutoScroll);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("dblclick", onDouble);
      renderer.domElement.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(frame);
      hoverLook.dispose();
      geometries.forEach((g) => g.dispose());
      meshes.forEach(({ mesh }) => mesh.dispose());
      material.dispose();
      cad.dispose();
      studio.dispose();
      clear.forEach((m) => m.dispose());
      ghost.dispose();
      glow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.current = null;
      setGone([]);
    };
  }, [model]);

  // Colours and Locate.
  const loaded = progress === null;
  useEffect(() => {
    if (loaded) onLocated(scene.current?.paint(colors, mode, locateKey) ?? false);
  }, [loaded, colors, mode, locateKey, onLocated]);
  const selectedKeyRef = useRef(selectedKey);
  useEffect(() => {
    if (!loaded) return;
    if (hidden) scene.current?.hide(hidden);
    scene.current?.select(selectedKeyRef.current ?? null);
  }, [loaded, hidden]);
  useEffect(() => {
    selectedKeyRef.current = selectedKey;
    if (loaded) scene.current?.select(selectedKey ?? null);
  }, [loaded, selectedKey]);

  return (
    <div ref={host} className="absolute inset-0">
      {progress && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted tabular-nums">
          Loading the robot… {progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%
        </div>
      )}
      {error && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted">{error}</div>}
      {gone.length > 0 && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={panelLeft !== undefined ? { left: panelLeft } : undefined}
          className="absolute top-3 left-3 z-10 flex max-h-[calc(100%-4rem)] w-44 animate-pop cursor-auto flex-col overflow-hidden rounded-md border border-line bg-surface/95 text-xs shadow-sm backdrop-blur"
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-2.5 py-1.5 font-semibold text-muted">
            <span className="tabular-nums">Hidden · {gone.length}</span>
            <button onClick={() => scene.current?.show(gone)} className="press font-medium text-accent-hover hover:underline">
              Show all
            </button>
          </div>
          <ul className="flex-1 overflow-y-auto p-1">
            {gone
              .slice()
              .reverse()
              .map((g) => (
                <li key={`${g.m}:${g.i}`}>
                  <button
                    onClick={() => scene.current?.show([g])}
                    title="Show it again"
                    className="press block w-full truncate rounded px-2 py-1.5 text-left text-fg-2 hover:bg-raised hover:text-fg pointer-coarse:min-h-9"
                  >
                    {names?.get(g.key) ?? "Part"}
                  </button>
                </li>
              ))}
          </ul>
          <p className="border-t border-line px-2.5 py-1 text-[10px] text-subtle pointer-coarse:hidden">Y hides · Shift+Y brings back</p>
        </div>
      )}
    </div>
  );
}
