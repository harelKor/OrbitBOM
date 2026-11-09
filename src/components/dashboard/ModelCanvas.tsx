"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { edgePositions } from "@/lib/model/edges";
import { measure as measurePicks, placeEdge, placeFace, placePoint, type Picked, type Row } from "@/lib/model/measure";
import { topology, type Topology, type V3 } from "@/lib/model/topology";
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
const EDGE = "#15171d"; // Onshape's dark face borders

// Onshape's colours are sRGB; three.js works in linear light, so they're converted on the way
// in (read as linear, every colour came out pale: aluminium white, greens pastel).
const srgb = ([r, g, b]: [number, number, number]) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

// The face borders of every copy of a part, drawn in one call: the lines read the part's own
// instance matrices (so a hidden copy hides its lines too) and honour the section plane.
function edgeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(EDGE) }, opacity: { value: 0.85 } },
    vertexShader: `#include <common>
#include <clipping_planes_pars_vertex>
attribute mat4 instanceMatrix;
void main() {
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`,
    fragmentShader: `#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 color;
uniform float opacity;
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vec4(color, opacity);
  #include <colorspace_fragment>
}`,
    transparent: true,
    depthWrite: false,
    clipping: true,
  });
}

// A part instance hidden with Y: its mesh, its index there, and its BOM key.
type Gone = { m: number; i: number; key: string };

// CAD Review's viewer tools (plan/design-review.md): standard views, a section plane, measuring
// between two points on the meshes (≈: the export's chord tolerance), hiding or isolating a part.
export type ViewName = "front" | "top" | "side" | "iso";
export type Axis = "x" | "y" | "z";
export type Section = { axis: Axis; at: number; flip: boolean };
// Directions from the model to the camera, in the scene's Y-up frame (Onshape's Z is up).
const VIEWS: Record<ViewName, [number, number, number]> = { front: [0, 0, 1], top: [0, 1, 0.0001], side: [1, 0, 0], iso: [1, 1, 1] };
// The parts hidden with Y or Hide, for a page that lists them itself (CAD folds the list under its
// Tools on phones, Harel 2026-11-09).
export type HiddenParts = { items: { id: string; name: string }[]; show: (id: string | null) => void };

// Measure chosen faces, edges and corners like Onshape's selection filter: Any takes a corner, else
// an edge, else the face under the pointer (Harel, 2026-11-09).
export type MeasureFilter = "any" | "face" | "edge" | "point";
export type MeasureInfo = { picks: string[]; rows: Row[] };

export type SceneTools = {
  view: (name: ViewName | "fit") => void;
  section: (s: Section | null) => void;
  measure: (filter: MeasureFilter | null) => void;
  hideKey: (key: string) => void;
  isolate: (key: string | null) => void;
  partSize: (key: string) => [number, number, number] | null;
};

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
  onTools,
  onMeasure,
  onHidden,
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
  onTools?: (tools: SceneTools | null) => void; // the review tools, once the model is loaded
  onMeasure?: (m: MeasureInfo) => void;
  onHidden?: (h: HiddenParts | null) => void; // the page shows the hidden parts list itself
}) {
  const host = useRef<HTMLDivElement>(null);
  // Recolours the parts and frames the located one; true when it is in the model.
  const scene = useRef<{
    paint: (colors: Map<string, string>, mode: ViewerMode, locateKey: string | null) => boolean;
    hide: (hidden: Set<number>) => void;
    select: (key: string | null) => void;
    show: (gone: Gone[]) => void;
    tools: SceneTools;
  } | null>(null);
  const toolsRef = useRef(onTools);
  useEffect(() => {
    toolsRef.current = onTools;
  }, [onTools]);
  const namesRef = useRef(names);
  useEffect(() => {
    namesRef.current = names;
  }, [names]);
  const measureRef = useRef(onMeasure);
  useEffect(() => {
    measureRef.current = onMeasure;
  }, [onMeasure]);
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
    // Lit like Onshape: mostly from the viewer (a light riding on the camera, a little above and
    // to the left), with a soft sky fill, so faces turned away read darker and edges stay crisp.
    world.add(new THREE.HemisphereLight(0xffffff, 0x5d6372, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 0.5);
    sun.position.set(2, 4, 3);
    world.add(sun);
    // CAD mode's studio reflections, kept faint, so metal parts read as metal without glare.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    world.environmentIntensity = 0.35;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.005, 200);
    camera.position.set(1.4, 1, 1.4);
    const headlight = new THREE.DirectionalLight(0xffffff, 2.1);
    headlight.position.set(-0.4, 0.6, 0);
    headlight.target.position.set(0, 0, -1);
    camera.add(headlight, headlight.target);
    world.add(camera);
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

    // Faces sit a hair behind their edges, so the border lines never flicker through them.
    const offset = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
    const material = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05, ...offset });
    const cad = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2, ...offset });
    const edgeLook = edgeMaterial();
    const ghost = new THREE.MeshStandardMaterial({ roughness: 0.6, transparent: true, opacity: 0.14, depthWrite: false });
    const glow = new THREE.MeshStandardMaterial({ color: LOCATED, emissive: LOCATED, emissiveIntensity: 0.55, roughness: 0.4 });
    const geometries: THREE.BufferGeometry[] = [];
    const meshes: { mesh: THREE.InstancedMesh; keys: string[]; g: number; look?: Appearance }[] = [];
    // Onshape's see-through appearances, one material per opacity.
    const clear = new Map<number, THREE.MeshStandardMaterial>();
    const seeThrough = (opacity: number) => {
      let m = clear.get(opacity);
      if (!m) {
        m = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1, transparent: true, opacity, depthWrite: false, ...offset });
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
      // Edges fade with the robot while locating, and are lighter over status colours.
      edgeLook.uniforms.opacity.value = locateKey ? 0.05 : mode === "cad" ? 0.85 : 0.55;
      const plain = new THREE.Color(PLAIN);
      const box = new THREE.Box3();
      const piece = new THREE.Box3();
      for (const { mesh, keys, look } of meshes) {
        const own = mode === "cad" && look;
        mesh.material = locateKey ? ghost : own && look.opacity < 1 ? seeThrough(look.opacity) : mode === "cad" ? cad : material;
        const onshape = own ? srgb(look.color) : plain;
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
    // Hiding a subsystem hides its meshes (hideGroups below); the framing stays where it is.
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
    // Standard views and fit, framed on what's shown.
    const shownBox = () => {
      const box = new THREE.Box3();
      for (const { mesh } of meshes) if (mesh.visible) box.expandByObject(mesh);
      return box;
    };
    const view = (name: ViewName | "fit") => {
      if (name !== "fit") {
        const [x, y, z] = VIEWS[name];
        const d = camera.position.distanceTo(controls.target);
        camera.position.copy(controls.target).addScaledVector(new THREE.Vector3(x, y, z).normalize(), d);
      }
      fit(shownBox());
    };
    // One section plane across the model's box, at a fraction of it along an axis.
    const plane = new THREE.Plane();
    const section = (s: Section | null) => {
      for (const m of [material, cad]) {
        m.side = s ? THREE.DoubleSide : THREE.FrontSide;
        m.needsUpdate = true;
      }
      if (!s) renderer.clippingPlanes = [];
      else {
        const box = new THREE.Box3().setFromObject(root);
        const i = s.axis === "x" ? 0 : s.axis === "y" ? 1 : 2;
        const at = box.min.getComponent(i) + (box.max.getComponent(i) - box.min.getComponent(i)) * s.at;
        // Keeps the side below `at` (above it when flipped).
        plane.set(new THREE.Vector3().setComponent(i, s.flip ? 1 : -1), s.flip ? -at : at);
        renderer.clippingPlanes = [plane];
      }
      render();
    };
    // Measure: faces, edges and corners picked like Onshape (hover blue, picked orange), up to two;
    // their sizes, distance and angle go to the page (measure.ts). Each part shape's faces and edges
    // are worked out once, the first time the pointer meets it.
    let filter: MeasureFilter | null = null;
    type Pick = { m: number; i: number; kind: "face" | "edge" | "point"; n: number };
    let chosen: Pick[] = [];
    let hoverPick: Pick | null = null;
    const topo = new Map<THREE.BufferGeometry, Topology>();
    const topoOf = (m: number) => {
      const g = meshes[m].mesh.geometry;
      let t = topo.get(g);
      if (!t) {
        t = topology(g.getAttribute("position").array, g.index!.array);
        topo.set(g, t);
      }
      return t;
    };
    const placeOf = (m: number, i: number) => {
      const at = new THREE.Matrix4();
      meshes[m].mesh.getMatrixAt(i, at);
      return at;
    };
    const marks = new THREE.Group();
    root.add(marks);
    const PICKED = 0xff8a1f;
    const roundDot = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(16, 16, 15, 0, Math.PI * 2);
      g.fill();
      return new THREE.CanvasTexture(c);
    })();
    const looks = {
      face: [HOVER, PICKED].map((color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
      line: [HOVER, PICKED].map((color) => new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true })),
      // Points: a small round dot of fixed size on screen, whatever the zoom, like Onshape's
      // (Harel, 2026-11-09).
      dot: [HOVER, PICKED].map((color) => new THREE.PointsMaterial({ color, size: 7, sizeAttenuation: false, map: roundDot, alphaTest: 0.5, depthTest: false, transparent: true })),
      gap: new THREE.LineDashedMaterial({ color: 0xffd23f, dashSize: 0.004, gapSize: 0.003, depthTest: false, transparent: true }),
    };
    // Each face's own triangles, kept for drawing it lit.
    const faceGeoms = new Map<string, THREE.BufferGeometry>();
    const faceGeom = (m: number, f: number) => {
      const g = meshes[m].mesh.geometry;
      const id = `${g.uuid}:${f}`;
      let fg = faceGeoms.get(id);
      if (!fg) {
        const idx = g.index!.array;
        const tris = topoOf(m).faces[f].tris;
        const sub = new Uint32Array(tris.length * 3);
        tris.forEach((t, k) => sub.set([idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]], k * 3));
        fg = new THREE.BufferGeometry();
        fg.setAttribute("position", g.getAttribute("position"));
        fg.setIndex(new THREE.BufferAttribute(sub, 1));
        faceGeoms.set(id, fg);
      }
      return fg;
    };
    const kindName = (pk: Pick) => {
      const t = topoOf(pk.m);
      if (pk.kind === "point") return "Point";
      if (pk.kind === "edge") return { line: "Straight edge", circle: "Round edge", other: "Edge" }[t.edges[pk.n].kind];
      return { plane: "Flat face", cylinder: "Round face", other: "Face" }[t.faces[pk.n].kind];
    };
    const drawMarks = (line: [V3, V3] | null) => {
      // Lines and dots are made per draw; face geometries are kept (faceGeoms).
      for (const c of marks.children) if ((c as THREE.Line).isLine || (c as THREE.Points).isPoints) (c as THREE.Mesh).geometry.dispose();
      marks.clear();
      const draw = (pk: Pick, lit: number) => {
        const at = placeOf(pk.m, pk.i);
        const t = topoOf(pk.m);
        let obj: THREE.Object3D;
        if (pk.kind === "face") obj = new THREE.Mesh(faceGeom(pk.m, pk.n), looks.face[lit]);
        else if (pk.kind === "edge") {
          const e = t.edges[pk.n];
          const geo = new THREE.BufferGeometry().setFromPoints(e.points.map((q) => new THREE.Vector3(...q)));
          obj = e.closed ? new THREE.LineLoop(geo, looks.line[lit]) : new THREE.Line(geo, looks.line[lit]);
        } else {
          obj = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...t.corners[pk.n])]), looks.dot[lit]);
        }
        obj.matrix.premultiply(at);
        obj.matrixAutoUpdate = false;
        obj.renderOrder = 12;
        marks.add(obj);
      };
      if (hoverPick && !chosen.some((q) => same(q, hoverPick!))) draw(hoverPick, 0);
      for (const pk of chosen) draw(pk, 1);
      if (line) {
        const gap = new THREE.Line(new THREE.BufferGeometry().setFromPoints(line.map((q) => new THREE.Vector3(...q))), looks.gap);
        gap.computeLineDistances();
        gap.renderOrder = 13;
        marks.add(gap);
      }
      render();
    };
    const same = (a: Pick, b: Pick) => a.m === b.m && a.i === b.i && a.kind === b.kind && a.n === b.n;
    let lastLine: [V3, V3] | null = null;
    const report = () => {
      const placed: Picked[] = chosen.map((pk) => {
        const at = placeOf(pk.m, pk.i).elements;
        const t = topoOf(pk.m);
        const name = namesRef.current?.get(meshes[pk.m].keys[pk.i]) ?? "Part";
        if (pk.kind === "face") {
          const g = meshes[pk.m].mesh.geometry;
          return placeFace(t.faces[pk.n], g.getAttribute("position").array, g.index!.array, at, name);
        }
        if (pk.kind === "edge") return placeEdge(t.edges[pk.n], at, name);
        return placePoint(t.corners[pk.n], at, name);
      });
      const { rows, line } = measurePicks(placed);
      lastLine = line;
      drawMarks(line);
      measureRef.current?.({ picks: chosen.map((pk, k) => `${kindName(pk)} · ${placed[k].name}`), rows });
    };
    const measure = (f: MeasureFilter | null) => {
      const was = filter;
      filter = f;
      if (!f || !was) chosen = [];
      hoverPick = null;
      setHover(null);
      report();
    };
    // A part's every copy hidden (the touch way to Y), or only that part shown.
    const hideKey = (key: string) => {
      meshes.forEach(({ keys }, m) => keys.forEach((k, i) => k === key && !kept.has(`${m}:${i}`) && hideOne({ m, i, key })));
    };
    let isolated: string | null = null;
    let groupsHidden = new Set<number>();
    const applyVisible = () => {
      for (const { mesh, g, keys } of meshes) mesh.visible = !groupsHidden.has(g) && (!isolated || keys.includes(isolated));
      select(selectedNow);
    };
    const hideGroups = (hidden: Set<number>) => {
      groupsHidden = hidden;
      applyVisible();
    };
    const isolate = (key: string | null) => {
      isolated = key;
      applyVisible();
      fit(shownBox());
    };
    // The part's size along the model's axes, in mm (its first copy's box).
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
    scene.current = {
      paint,
      hide: hideGroups,
      select: (key) => select((selectedNow = key)),
      show,
      tools: { view, section, measure, hideKey, isolate, partSize },
    };

    // Left click (not a drag) chosen the part under the pointer; a double-click opens it.
    const ray = new THREE.Raycaster();
    const hitAt = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1)), camera);
      const [hit] = ray.intersectObjects(
        meshes.filter((m) => m.mesh.visible).map((m) => m.mesh),
        false,
      );
      const m = hit ? meshes.findIndex((x) => x.mesh === hit.object) : -1;
      return m >= 0 && hit.instanceId !== undefined ? { m, i: hit.instanceId, point: hit.point, tri: hit.faceIndex ?? 0 } : null;
    };
    const keyAt = (e: MouseEvent) => {
      const h = hitAt(e);
      return h ? (meshes[h.m].keys[h.i] ?? null) : null;
    };
    // The face, edge or corner under the pointer, by the filter, on the part the ray meets: corners
    // and edges within a few pixels of it on screen (more for a finger).
    const pickAt = (e: MouseEvent, finger: boolean): Pick | null => {
      const h = hitAt(e);
      if (!h || !filter) return null;
      const t = topoOf(h.m);
      const toScreen = placeOf(h.m, h.i).premultiply(root.matrixWorld);
      const rect = renderer.domElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const v = new THREE.Vector3();
      const screen = (q: V3): [number, number] => {
        v.set(q[0], q[1], q[2]).applyMatrix4(toScreen).project(camera);
        return [((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height];
      };
      if (filter === "any" || filter === "point") {
        let best = finger ? 22 : 10;
        let n = -1;
        t.corners.forEach((q, k) => {
          const [sx, sy] = screen(q);
          const d = Math.hypot(sx - x, sy - y);
          if (d < best) [best, n] = [d, k];
        });
        if (n >= 0) return { m: h.m, i: h.i, kind: "point", n };
      }
      if (filter === "any" || filter === "edge") {
        let best = finger ? 16 : 7;
        let n = -1;
        t.edges.forEach((ed, k) => {
          const pts = ed.points.map(screen);
          const count = ed.closed ? pts.length : pts.length - 1;
          for (let j = 0; j < count; j++) {
            const [ax, ay] = pts[j];
            const [bx, by] = pts[(j + 1) % pts.length];
            const dx = bx - ax, dy = by - ay;
            const l2 = dx * dx + dy * dy;
            const u = l2 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
            const d = Math.hypot(ax + u * dx - x, ay + u * dy - y);
            if (d < best) [best, n] = [d, k];
          }
        });
        if (n >= 0) return { m: h.m, i: h.i, kind: "edge", n };
      }
      if (filter === "any" || filter === "face") return { m: h.m, i: h.i, kind: "face", n: t.triFace[h.tri] };
      return null;
    };
    // Hover: one ray per frame at most, mouse only, not while dragging.
    let over = false;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      over = true;
      cancelAnimationFrame(frame);
      if (e.pointerType !== "mouse" || e.buttons) return setHover(null);
      frame = requestAnimationFrame(() => {
        if (filter) {
          const pk = pickAt(e, false);
          if (pk === hoverPick || (pk && hoverPick && same(pk, hoverPick))) return;
          hoverPick = pk;
          drawMarks(lastLine);
          return;
        }
        const h = hitAt(e);
        setHover(h && { m: h.m, i: h.i });
      });
    };
    const onLeave = () => {
      over = false;
      cancelAnimationFrame(frame);
      setHover(null);
      if (hoverPick) {
        hoverPick = null;
        drawMarks(lastLine);
      }
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
        hideOne({ m: hovered.m, i: hovered.i, key: meshes[hovered.m].keys[hovered.i] });
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
      if (filter) {
        // A tap chosen (or drops) one; a third starts over; empty space clears.
        const pk = pickAt(e, e.pointerType !== "mouse");
        if (!pk) chosen = [];
        else if (chosen.some((q) => same(q, pk))) chosen = chosen.filter((q) => !same(q, pk));
        else chosen = chosen.length >= 2 ? [pk] : [...chosen, pk];
        report();
        return;
      }
      pick.current?.(keyAt(e));
    };
    const onDouble = (e: MouseEvent) => {
      if (e.button !== 0 || !openPart.current || filter) return;
      const key = keyAt(e);
      if (key) openPart.current(key);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    renderer.domElement.addEventListener("dblclick", onDouble);

    (async () => {
      const shapes: Map<string, { geometry: THREE.BufferGeometry; edges: Float32Array; look?: Appearance }>[] = [];
      let done = 0;
      const queue = model.studios.map((url, i) => ({ url, i }));
      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const byPart = new Map<string, { geometry: THREE.BufferGeometry; edges: Float32Array; look?: Appearance }>();
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
          if (!disposed) setProgress({ done: ++done, total: model.studios.length });
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      if (disposed) return;

      // One instanced mesh per (subsystem, Part Studio, part).
      const groups = new Map<string, { geometry: THREE.BufferGeometry; edges: Float32Array; look?: Appearance; items: typeof model.placements; g: number }>();
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
        const mesh = new THREE.InstancedMesh(geometry, material, items.length);
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
          const segs = new THREE.LineSegments(lines, edgeLook);
          segs.frustumCulled = false;
          segs.raycast = () => {};
          mesh.add(segs);
        }
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
      if (scene.current) toolsRef.current?.(scene.current.tools);
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
      for (const c of marks.children) if ((c as THREE.Line).isLine || (c as THREE.Points).isPoints) (c as THREE.Mesh).geometry.dispose();
      faceGeoms.forEach((g) => g.dispose());
      [...looks.face, ...looks.line, ...looks.dot, looks.gap].forEach((m) => m.dispose());
      roundDot.dispose();
      meshes.forEach(({ mesh }) => mesh.dispose());
      material.dispose();
      cad.dispose();
      edgeLook.dispose();
      studio.dispose();
      clear.forEach((m) => m.dispose());
      ghost.dispose();
      glow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.current = null;
      toolsRef.current?.(null);
      setGone([]);
    };
  }, [model]);

  // The hidden parts, handed to a page that lists them itself; null when none are hidden.
  const hiddenRef = useRef(onHidden);
  useEffect(() => {
    hiddenRef.current = onHidden;
  }, [onHidden]);
  useEffect(() => {
    hiddenRef.current?.(
      gone.length
        ? {
            items: gone.map((g) => ({ id: `${g.m}:${g.i}`, name: names?.get(g.key) ?? "Part" })).reverse(),
            show: (id) => scene.current?.show(id ? gone.filter((g) => `${g.m}:${g.i}` === id) : gone),
          }
        : null,
    );
  }, [gone, names]);

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
      {gone.length > 0 && !onHidden && (
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
