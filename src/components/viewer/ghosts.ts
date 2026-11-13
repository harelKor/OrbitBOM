// Isolate's ghosts (Harel, 2026-11-13): the parts left out drawn see-through only near the
// isolated parts, fading out with the distance from them. One slider sets both how far they
// reach and how clear the nearest are; at 0 there are none. The distance is measured in the
// shader, to the nearest of a few boxes round the isolated parts' copies.
import * as THREE from "three";

const MAX_BOXES = 24; // the shader's box slots; more copies than this share boxes
const PEAK_MIN = 0.06; // the nearest ghosts' opacity at the slider's low end…
const PEAK_MAX = 0.4; // …and at its top

// The slider (0–1) as how far the ghosts reach (metres) and how see-through the nearest are.
export function ghostReach(s: number, modelSize: number) {
  return { reach: Math.max(1e-4, modelSize * s), peak: PEAK_MIN + (PEAK_MAX - PEAK_MIN) * s };
}

// Boxes merged down to `max`: sorted along the longest side of all of them, then cut into
// even runs, each run one box.
export function mergeBoxes(boxes: THREE.Box3[], max = MAX_BOXES): THREE.Box3[] {
  if (boxes.length <= max) return boxes;
  const all = new THREE.Box3();
  boxes.forEach((b) => all.union(b));
  const size = all.getSize(new THREE.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
  const c = new THREE.Vector3();
  const sorted = boxes.map((b) => ({ b, at: b.getCenter(c)[axis] })).sort((p, q) => p.at - q.at);
  const out: THREE.Box3[] = [];
  for (let k = 0; k < max; k++) {
    const from = Math.floor((k * sorted.length) / max);
    const to = Math.floor(((k + 1) * sorted.length) / max);
    if (to <= from) continue;
    const box = new THREE.Box3();
    for (let i = from; i < to; i++) box.union(sorted[i].b);
    out.push(box);
  }
  return out;
}

export type GhostLook = {
  material: THREE.MeshStandardMaterial;
  around: (boxes: THREE.Box3[], modelSize: number, s: number) => void;
  dispose: () => void;
};

export function createGhostLook(): GhostLook {
  const uniforms = {
    ghostMin: { value: Array.from({ length: MAX_BOXES }, () => new THREE.Vector3()) },
    ghostMax: { value: Array.from({ length: MAX_BOXES }, () => new THREE.Vector3()) },
    ghostCount: { value: 0 },
    ghostReach: { value: 1 },
    ghostPeak: { value: PEAK_MIN },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xb4bcc8, roughness: 0.6, transparent: true, depthWrite: false });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vGhostWorld;").replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      vec4 ghostAt = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        ghostAt = instanceMatrix * ghostAt;
      #endif
      vGhostWorld = ( modelMatrix * ghostAt ).xyz;`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vGhostWorld;
        uniform vec3 ghostMin[ ${MAX_BOXES} ];
        uniform vec3 ghostMax[ ${MAX_BOXES} ];
        uniform int ghostCount;
        uniform float ghostReach;
        uniform float ghostPeak;
        float ghostAlpha() {
          float d = 1e9;
          for ( int i = 0; i < ${MAX_BOXES}; i ++ ) {
            if ( i >= ghostCount ) break;
            vec3 out3 = max( max( ghostMin[ i ] - vGhostWorld, vGhostWorld - ghostMax[ i ] ), 0.0 );
            d = min( d, length( out3 ) );
          }
          float t = 1.0 - smoothstep( 0.0, ghostReach, d );
          return ghostPeak * t * t;
        }`,
      )
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>
        gl_FragColor.a = ghostAlpha();
        if ( gl_FragColor.a < 0.004 ) discard;`,
      );
  };
  material.customProgramCacheKey = () => "ghost-fade";

  return {
    material,
    around: (boxes, modelSize, s) => {
      const merged = mergeBoxes(boxes);
      merged.forEach((b, i) => {
        uniforms.ghostMin.value[i].copy(b.min);
        uniforms.ghostMax.value[i].copy(b.max);
      });
      uniforms.ghostCount.value = merged.length;
      const { reach, peak } = ghostReach(s, modelSize);
      uniforms.ghostReach.value = reach;
      uniforms.ghostPeak.value = peak;
    },
    dispose: () => material.dispose(),
  };
}
