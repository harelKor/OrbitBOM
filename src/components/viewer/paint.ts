// How the parts look: the colours, the materials, and painting them by status (or CAD: Onshape's
// own appearance, see-through parts included, lit by a studio environment like Onshape's). While
// locating, the robot turns see-through and the located part is drawn solid in bright green.
// Onshape's render modes (S9, from the view cube's menu) choose how faces and edges are drawn, and
// curved parts get Onshape's silhouette outline.
import * as THREE from "three";
import type { Stage } from "./stage";
import type { PartMesh, ViewerMode } from "./types";

export const PLAIN = "#9aa1ad"; // a part with no Onshape appearance in its file
export const UNKNOWN = "#b8bec9"; // placed in CAD but not on the BOM
// Tint mode: how far a part's Onshape colour moves toward its status colour. Light, so the robot
// still reads as the CAD and the status shows as a hint, not a patchwork (Harel, 2026-11-13).
const TINT = 0.3;
const NOT_STARTED = new THREE.Color("#cbd5e1"); // statuses.ts; not tinted, like UNKNOWN
export const LOCATED = "#22ff5e"; // the located part: bright green, through a see-through robot
export const HOVER = "#6f9bff"; // a light blue wash over the part under the mouse, like Onshape's
export const EDGE = "#15171d"; // Onshape's dark face borders

// Onshape's render modes, in its menu's order (S9; Harel, 2026-11-11: copy Onshape's assembly view).
export type DisplayMode = "shadedEdges" | "shaded" | "shadedHidden" | "hiddenRemoved" | "hiddenVisible" | "translucent";
export const DISPLAY_MODES: { v: DisplayMode; label: string }[] = [
  { v: "shadedEdges", label: "Shaded with edges" },
  { v: "shaded", label: "Shaded" },
  { v: "shadedHidden", label: "Shaded with hidden edges" },
  { v: "hiddenRemoved", label: "Hidden edges removed" },
  { v: "hiddenVisible", label: "Hidden edges visible" },
  { v: "translucent", label: "Translucent" },
];
export type DisplayTools = {
  display: () => DisplayMode;
  setDisplay: (m: DisplayMode) => void;
  // Version compare (Harel, 2026-11-17): each listed subsystem group drawn at that opacity (0–1)
  // over its colours; null ends it.
  fadeGroups: (opacity: Map<number, number> | null) => void;
};
const LINE_FACE = "#ffffff"; // the faces in the hidden-line modes: plain white, like Onshape's
const TRANSLUCENT = 0.3;

// Onshape's colours are sRGB; three.js works in linear light, so they're converted on the way
// in (read as linear, every colour came out pale: aluminium white, greens pastel).
// A part's Onshape colour with a light wash of its status colour; no wash when it has no status
// yet (Not Started, or not on the BOM).
// Parts with a status are also a little brighter and Not Started ones a little dimmer, so the
// work under way stands out (Harel, 2026-11-13).
function tinted(onshape: THREE.Color, status: string | undefined): THREE.Color {
  const c = status ? new THREE.Color(status) : null;
  if (!c || c.equals(NOT_STARTED)) return onshape.clone().multiplyScalar(DIM);
  return onshape.clone().lerp(c, TINT).lerp(WHITE, BRIGHTEN);
}
const DIM = 0.75;
const BRIGHTEN = 0.12;
const WHITE = new THREE.Color(1, 1, 1);
export const srgb = ([r, g, b]: [number, number, number]) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

// The face borders of every copy of a part, drawn in one call: the lines read the part's own
// instance matrices (so a hidden copy hides its lines too) and honour the section plane. `hidden`:
// only the stretches behind a face (the depth test reversed), drawn faint for the hidden-edge modes.
function edgeMaterial(hidden = false) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(EDGE) }, opacity: { value: hidden ? 0.3 : 0.85 } },
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
    ...(hidden && { depthFunc: THREE.GreaterDepth }),
    clipping: true,
  });
}

// Onshape's silhouette outline (S9): the part's back faces pushed out about a pixel on screen and
// drawn dark behind it, so a tube or a round standoff gets its outline where it curves away, as
// Onshape's does (flat parts have face borders there already). Cheap: one more draw per part, no
// pass over the whole screen. Shares the part's instance matrices, so hidden copies have none.
function outlineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(EDGE) }, width: { value: 1.2 }, screen: { value: new THREE.Vector2(1, 1) } },
    vertexShader: `#include <common>
#include <clipping_planes_pars_vertex>
attribute mat4 instanceMatrix;
uniform float width;
uniform vec2 screen;
void main() {
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vec3 n = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vec2 d = (projectionMatrix * vec4(n, 0.0)).xy * screen;
  float l = length(d);
  if (l > 1e-6) gl_Position.xy += d / l * width * 2.0 / screen * gl_Position.w;
  #include <clipping_planes_vertex>
}`,
    fragmentShader: `#include <common>
#include <clipping_planes_pars_fragment>
uniform vec3 color;
void main() {
  #include <clipping_planes_fragment>
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`,
    side: THREE.BackSide,
    clipping: true,
    // Behind the faces' own offset, so a flat section cap (no stencil) wins over it.
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
}

export type Looks = {
  material: THREE.MeshStandardMaterial; // status colours (per instance)
  cad: THREE.MeshStandardMaterial; // Onshape's colours (per instance)
  edgeLook: THREE.ShaderMaterial; // face borders
  hiddenEdgeLook: THREE.ShaderMaterial; // face borders behind faces (hidden-edge modes)
  outlineLook: THREE.ShaderMaterial; // silhouettes
  lineFace: THREE.MeshBasicMaterial; // faces in the hidden-line modes
  translucent: (base: THREE.Material) => THREE.Material; // Translucent mode's copy of a material
  ghost: THREE.MeshStandardMaterial; // the see-through robot while locating
  glow: THREE.MeshStandardMaterial; // located / selected parts
  seeThrough: (opacity: number) => THREE.MeshStandardMaterial; // Onshape's see-through appearances
  dispose: () => void;
};

export function createLooks(): Looks {
  // Faces sit a hair behind their edges, so the border lines never flicker through them.
  const offset = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
  const material = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05, ...offset });
  const cad = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.2, ...offset });
  const edgeLook = edgeMaterial();
  const hiddenEdgeLook = edgeMaterial(true);
  const outlineLook = outlineMaterial();
  const lineFace = new THREE.MeshBasicMaterial({ color: LINE_FACE, ...offset });
  const faint = new Map<THREE.Material, THREE.Material>();
  const translucent = (base: THREE.Material) => {
    let m = faint.get(base);
    if (!m) {
      m = base.clone();
      m.transparent = true;
      m.opacity = Math.min(base.opacity, TRANSLUCENT);
      m.depthWrite = false;
      faint.set(base, m);
    }
    return m;
  };
  const ghost = new THREE.MeshStandardMaterial({ roughness: 0.6, transparent: true, opacity: 0.14, depthWrite: false });
  const glow = new THREE.MeshStandardMaterial({ color: LOCATED, emissive: LOCATED, emissiveIntensity: 0.55, roughness: 0.4 });
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
  return {
    material,
    cad,
    edgeLook,
    hiddenEdgeLook,
    outlineLook,
    lineFace,
    translucent,
    ghost,
    glow,
    seeThrough,
    dispose: () => {
      material.dispose();
      cad.dispose();
      edgeLook.dispose();
      hiddenEdgeLook.dispose();
      outlineLook.dispose();
      lineFace.dispose();
      faint.forEach((m) => m.dispose());
      clear.forEach((m) => m.dispose());
      ghost.dispose();
      glow.dispose();
    },
  };
}

// Recolours the parts and frames the located one; true when it is in the model.
export type Paint = (colors: Map<string, string>, mode: ViewerMode, locateKey: string | null) => boolean;

export type Painter = {
  paint: Paint;
  display: () => DisplayMode;
  setDisplay: (m: DisplayMode) => void; // paints again in the new mode (the caller repaints see-through parts)
  outlines: (on: boolean) => void; // phones drop the silhouettes while the view moves
  fade: (opacity: Map<number, number> | null) => void;
  dispose: () => void;
};

export function createPaint(stage: Stage, meshes: PartMesh[], looks: Looks, fit: (box: THREE.Box3, minRadius?: number) => void): Painter {
  const { world, root, studio, render, renderer } = stage;
  const { material, cad, edgeLook, hiddenEdgeLook, outlineLook, lineFace, translucent, ghost, glow, seeThrough } = looks;
  const highlights = new THREE.Group();
  root.add(highlights);
  let display: DisplayMode = "shadedEdges";
  let outlinesOn = true;
  let last: Parameters<Paint> | null = null;
  // Version compare's fade: a see-through copy of the status material per faded group.
  const fades = new Map<number, THREE.MeshStandardMaterial>();
  const setFade = (m: THREE.MeshStandardMaterial, op: number) => {
    const clear = op < 0.995;
    if (m.transparent !== clear) m.needsUpdate = true;
    m.transparent = clear;
    m.opacity = op;
    m.depthWrite = !clear;
  };

  // Each part's silhouette and hidden-edge lines, made the first time it is painted: children of
  // its mesh (hidden with it) on its own geometry and instance matrices, never picked. Added
  // after load.ts's face borders, which stay the mesh's first line child (picking reads it).
  const made = new WeakSet<THREE.InstancedMesh>();
  const hulls: THREE.Mesh[] = [];
  const extras = (mesh: THREE.InstancedMesh) => {
    if (made.has(mesh)) return;
    made.add(mesh);
    if (!mesh.boundingBox) mesh.computeBoundingBox();
    const src = mesh.geometry;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", src.getAttribute("position"));
    g.setAttribute("normal", src.getAttribute("normal"));
    g.setIndex(src.getIndex());
    g.setAttribute("instanceMatrix", mesh.instanceMatrix);
    g.instanceCount = mesh.count;
    g.boundingBox = mesh.boundingBox!.clone(); // so framing measures the copies, not the origin
    const hull = new THREE.Mesh(g, outlineLook);
    hull.frustumCulled = false;
    hull.raycast = () => {};
    mesh.add(hull);
    hulls.push(hull);
    const segs = mesh.children.find((c) => (c as THREE.LineSegments).isLineSegments) as THREE.LineSegments | undefined;
    if (segs) {
      const hidden = new THREE.LineSegments(segs.geometry, hiddenEdgeLook);
      hidden.frustumCulled = false;
      hidden.raycast = () => {};
      mesh.add(hidden);
    }
  };
  // Silhouettes only behind solid faces: through a see-through one they'd show as a dark shape.
  const screen = new THREE.Vector2();
  stage.beforeRender.push(() => {
    renderer.getDrawingBufferSize(screen);
    outlineLook.uniforms.screen.value.copy(screen);
    outlineLook.uniforms.width.value = 1.2 * renderer.getPixelRatio();
    for (const h of hulls) {
      const m = (h.parent as THREE.Mesh | null)?.material as THREE.Material | undefined;
      h.visible = outlinesOn && !!m && !m.transparent;
    }
  });

  const paintNow = (colors: Map<string, string>, mode: ViewerMode, locateKey: string | null, refit: boolean) => {
    highlights.clear();
    // Hidden-line modes: white faces, dark edges, no colours (Onshape's); locating overrides them.
    const lines = !locateKey && (display === "hiddenRemoved" || display === "hiddenVisible");
    const cadLike = mode !== "status";
    world.environment = cadLike && !locateKey && !lines ? studio : null;
    // Edges fade with the robot while locating, and are lighter over status colours.
    edgeLook.uniforms.opacity.value = locateKey ? 0.05 : lines ? 0.95 : cadLike ? 0.85 : 0.55;
    edgeLook.visible = display !== "shaded" || !!locateKey;
    hiddenEdgeLook.visible = !locateKey && (display === "shadedHidden" || display === "hiddenVisible");
    const plain = new THREE.Color(PLAIN);
    const white = new THREE.Color(LINE_FACE);
    const box = new THREE.Box3();
    const piece = new THREE.Box3();
    for (const { mesh, keys, look, sketch, g } of meshes) {
      if (sketch) continue; // Geometry sketches keep their own lines (sketches.ts)
      extras(mesh);
      const own = cadLike && look;
      const base = locateKey ? ghost : own && look.opacity < 1 ? seeThrough(look.opacity) : cadLike ? cad : material;
      const faded = fades.get(g);
      mesh.material = faded && !locateKey ? faded : locateKey ? base : lines ? lineFace : display === "translucent" ? translucent(base) : base;
      // A faded copy's face borders go once it's mostly see-through.
      const borders = mesh.children[0];
      if (borders) borders.visible = !faded || faded.opacity >= 0.5;
      const onshape = own ? srgb(look.color) : plain;
      keys.forEach((k, i) => {
        mesh.setColorAt(i, locateKey ? plain : lines ? white : mode === "status" ? new THREE.Color(colors.get(k) ?? UNKNOWN) : mode === "tint" ? tinted(onshape, colors.get(k)) : onshape);
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
    if (found && refit) fit(box, new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).length() * 0.2);
    render();
    return found;
  };
  const paint: Paint = (colors, mode, locateKey) => {
    last = [colors, mode, locateKey];
    return paintNow(colors, mode, locateKey, true);
  };
  return {
    paint,
    display: () => display,
    setDisplay: (m) => {
      display = m;
      if (last) paintNow(...last, false);
      else render();
    },
    outlines: (on) => {
      outlinesOn = on;
      render();
    },
    fade: (opacity) => {
      const same = !!opacity && opacity.size === fades.size && [...opacity.keys()].every((g) => fades.has(g));
      if (!opacity) {
        fades.forEach((m) => m.dispose());
        fades.clear();
      } else {
        for (const [g, m] of fades)
          if (!opacity.has(g)) {
            m.dispose();
            fades.delete(g);
          }
        for (const [g, op] of opacity) {
          let m = fades.get(g);
          if (!m) {
            m = material.clone();
            fades.set(g, m);
          }
          setFade(m, Math.max(0, Math.min(1, op)));
        }
      }
      // Only the opacities moved (the slider): the materials are already on; else paint again.
      if (same) {
        for (const { mesh, g } of meshes) {
          const f = fades.get(g);
          if (f && mesh.children[0]) mesh.children[0].visible = f.opacity >= 0.5;
        }
        render();
      } else if (last) paintNow(...last, false);
      else render();
    },
    dispose: () => {
      fades.forEach((m) => m.dispose());
      highlights.clear();
      for (const h of hulls) h.geometry.dispose();
    },
  };
}
