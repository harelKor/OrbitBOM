// How the parts look: the colours, the materials, and painting them by status (or CAD: Onshape's
// own appearance, see-through parts included, lit by a studio environment like Onshape's). While
// locating, the robot turns see-through and the located part is drawn solid in bright green.
import * as THREE from "three";
import type { Stage } from "./stage";
import type { PartMesh, ViewerMode } from "./types";

export const PLAIN = "#9aa1ad"; // a part with no Onshape appearance in its file
export const UNKNOWN = "#b8bec9"; // placed in CAD but not on the BOM
export const LOCATED = "#22ff5e"; // the located part: bright green, through a see-through robot
export const HOVER = "#6f9bff"; // a light blue wash over the part under the mouse, like Onshape's
export const EDGE = "#15171d"; // Onshape's dark face borders

// Onshape's colours are sRGB; three.js works in linear light, so they're converted on the way
// in (read as linear, every colour came out pale: aluminium white, greens pastel).
export const srgb = ([r, g, b]: [number, number, number]) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

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

export type Looks = {
  material: THREE.MeshStandardMaterial; // status colours (per instance)
  cad: THREE.MeshStandardMaterial; // Onshape's colours (per instance)
  edgeLook: THREE.ShaderMaterial; // face borders
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
    ghost,
    glow,
    seeThrough,
    dispose: () => {
      material.dispose();
      cad.dispose();
      edgeLook.dispose();
      clear.forEach((m) => m.dispose());
      ghost.dispose();
      glow.dispose();
    },
  };
}

// Recolours the parts and frames the located one; true when it is in the model.
export type Paint = (colors: Map<string, string>, mode: ViewerMode, locateKey: string | null) => boolean;

export function createPaint(stage: Stage, meshes: PartMesh[], looks: Looks, fit: (box: THREE.Box3, minRadius?: number) => void): { paint: Paint; dispose: () => void } {
  const { world, root, studio, render } = stage;
  const { material, cad, edgeLook, ghost, glow, seeThrough } = looks;
  const highlights = new THREE.Group();
  root.add(highlights);
  const paint: Paint = (colors, mode, locateKey) => {
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
  return { paint, dispose: () => highlights.clear() };
}
