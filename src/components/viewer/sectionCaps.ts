// Section caps: the cut faces filled in, so a section reads like Onshape's (solid, each part in its
// own colour darkened) instead of showing the lit inside of the parts.
//
// With a stencil buffer (the renderer asked for one): the classic stencil capping, per plane and
// per cut part. The part's back faces count +1 and its front faces -1 into the stencil's low 7
// bits (clipped by that plane only), so a pixel where the plane lies inside the part ends non-zero;
// then a quad on the plane draws the cap there. The stencil's top bit remembers "a cap is already
// here": a second part's cap over it is drawn red, Onshape's interference hint.
// Without one: each cut part's back faces are drawn flat in the cap colour, which reads almost the
// same from most angles (no red then).
import * as THREE from "three";
import type { Stage } from "./stage";
import type { PartMesh } from "./types";

const CLIP = `uniform vec4 clip[3];
uniform int clipN;
varying vec3 vWorld;`;
const VERT = `#include <common>
${CLIP}
void main() {
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  #endif
  vec4 w = modelMatrix * p;
  vWorld = w.xyz;
  #ifdef USE_INSTANCING_COLOR
  vColor = instanceColor;
  #endif
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const FRAG = `#include <common>
${CLIP}
uniform vec3 color;
uniform float shade;
varying vec3 vColor;
void main() {
  for (int k = 0; k < 3; k++) {
    if (k >= clipN) break;
    if (dot(clip[k].xyz, vWorld) + clip[k].w < 0.0) discard;
  }
  #ifdef USE_INSTANCING_COLOR
  gl_FragColor = vec4(vColor * shade, 1.0);
  #else
  gl_FragColor = vec4(color * shade, 1.0);
  #endif
  #include <colorspace_fragment>
}`;
const vertWithColor = VERT.replace(CLIP, `${CLIP}\nvarying vec3 vColor;`);

// The cap colour: the part's own, darkened.
const SHADE = 0.55;
export const INTERFERENCE = "#ff2a2a";

function capMaterial(extra: THREE.ShaderMaterialParameters) {
  return new THREE.ShaderMaterial({
    uniforms: { clip: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }, clipN: { value: 0 }, color: { value: new THREE.Color() }, shade: { value: 1 } },
    vertexShader: vertWithColor,
    fragmentShader: FRAG,
    ...extra,
  });
}
const setClip = (m: THREE.ShaderMaterial, planes: THREE.Plane[]) => {
  const u = m.uniforms.clip.value as THREE.Vector4[];
  planes.slice(0, 3).forEach((p, k) => u[k].set(p.normal.x, p.normal.y, p.normal.z, p.constant));
  m.uniforms.clipN.value = Math.min(3, planes.length);
};

export type Caps = {
  // `world`: the clipping planes in world space; `model`: the same planes' point and normal in the
  // model frame (for placing the cap quads); `cut(m)`: whether mesh m is sectioned.
  update: (world: THREE.Plane[], model: { point: THREE.Vector3; normal: THREE.Vector3 }[], cut: (m: number) => boolean) => void;
  stencil: boolean;
  dispose: () => void;
};

export function createCaps(stage: Stage, meshes: PartMesh[]): Caps {
  const { renderer } = stage;
  const stencil = !!renderer.getContext().getContextAttributes()?.stencil;
  const made: THREE.Object3D[] = [];
  const materials: THREE.Material[] = [];
  const keep = <T extends THREE.Material>(m: T) => (materials.push(m), m);
  const quad = new THREE.PlaneGeometry(1, 1);
  const tiny = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));

  // An instanced twin of a part mesh: the same geometry, copies (hidden ones are drawn at no size)
  // and colours, under it so it hides with it.
  const twin = (pm: PartMesh, material: THREE.Material, order: number) => {
    const t = new THREE.InstancedMesh(pm.mesh.geometry, material, 0);
    t.instanceMatrix = pm.mesh.instanceMatrix;
    t.instanceColor = pm.mesh.instanceColor;
    t.count = pm.mesh.count;
    t.frustumCulled = false;
    t.renderOrder = order;
    t.raycast = () => {};
    pm.mesh.add(t);
    made.push(t);
    return t;
  };
  const meshBox = (pm: PartMesh) => {
    if (!pm.mesh.boundingBox) pm.mesh.computeBoundingBox();
    return pm.mesh.boundingBox!;
  };
  const straddles = (box: THREE.Box3, p: { point: THREE.Vector3; normal: THREE.Vector3 }) => {
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(p.normal, p.point);
    return !box.isEmpty() && plane.intersectsBox(box);
  };

  const clear = () => {
    for (const o of made) o.removeFromParent();
    made.length = 0;
    materials.forEach((m) => m.dispose());
    materials.length = 0;
  };

  const update: Caps["update"] = (world, model, cut) => {
    clear();
    if (!world.length) return;
    if (!stencil) {
      // Flat back faces, clipped by every plane like the parts.
      const back = keep(capMaterial({ side: THREE.BackSide }));
      back.uniforms.shade.value = SHADE;
      setClip(back, world);
      meshes.forEach((pm, m) => {
        if (cut(m) && model.some((p) => straddles(meshBox(pm), p))) twin(pm, back, 0);
      });
      return;
    }
    model.forEach((p, k) => {
      const others = world.filter((_, j) => j !== k);
      const own = [world[k]];
      const counting = (side: THREE.Side, op: THREE.StencilOp) => {
        const m = keep(capMaterial({ side, colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilWriteMask: 0x7f, stencilFail: op, stencilZFail: op, stencilZPass: op }));
        setClip(m, own);
        return m;
      };
      const back = counting(THREE.BackSide, THREE.IncrementWrapStencilOp);
      const front = counting(THREE.FrontSide, THREE.DecrementWrapStencilOp);
      const stamp = { stencilWrite: true, stencilRef: 0x80, stencilWriteMask: 0xff, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp, side: THREE.DoubleSide };
      // Inside this part where another part's cap already is (stencil > 0x80): red.
      const red = keep(capMaterial({ ...stamp, stencilFunc: THREE.LessStencilFunc, stencilFuncMask: 0xff }));
      red.uniforms.color.value.set(INTERFERENCE);
      setClip(red, others);
      // Inside this part (low bits not 0): the part's colour, darkened. Both stamp "a cap here".
      const fill = keep(capMaterial({ ...stamp, stencilFunc: THREE.NotEqualStencilFunc, stencilFuncMask: 0x7f }));
      fill.uniforms.shade.value = SHADE;
      setClip(fill, others);

      // The quad: on the plane, big enough to cover the part's copies, its normal along the plane's.
      const [u, v] = [new THREE.Vector3(), new THREE.Vector3()];
      const base = 1000 + k * 200000;
      if (k > 0) {
        // Each plane starts from a clean stencil.
        const wipe = new THREE.Mesh(tiny, keep(new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false })));
        wipe.frustumCulled = false;
        wipe.renderOrder = base - 1;
        wipe.onBeforeRender = (r) => r.clearStencil();
        stage.root.add(wipe);
        made.push(wipe);
      }
      meshes.forEach((pm, m) => {
        const box = meshBox(pm);
        if (!cut(m) || !straddles(box, p)) return;
        const order = base + m * 4;
        twin(pm, back, order);
        twin(pm, front, order + 1);
        const size = box.getSize(new THREE.Vector3()).length() * 1.05;
        const centre = box.getCenter(new THREE.Vector3());
        const at = centre.addScaledVector(p.normal, -centre.clone().sub(p.point).dot(p.normal));
        u.copy(Math.abs(p.normal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).cross(p.normal).normalize();
        v.crossVectors(p.normal, u);
        const place = new THREE.Matrix4().makeBasis(u.clone().multiplyScalar(size), v.clone().multiplyScalar(size), p.normal).setPosition(at);
        for (const [mat, n] of [
          [red, 2],
          [fill, 3],
        ] as const) {
          const cap = new THREE.Mesh(quad, mat);
          cap.matrix.copy(place);
          cap.matrixAutoUpdate = false;
          cap.frustumCulled = false;
          cap.renderOrder = order + n;
          cap.raycast = () => {};
          if (mat === fill) {
            // The part's colour now (paint.ts may have changed it since): its first copy's.
            cap.onBeforeRender = () => {
              const c = pm.mesh.instanceColor;
              if (c) fill.uniforms.color.value.setRGB(c.getX(0), c.getY(0), c.getZ(0));
              else fill.uniforms.color.value.set("#9aa1ad");
              fill.uniformsNeedUpdate = true;
            };
          }
          pm.mesh.add(cap);
          made.push(cap);
        }
      });
    });
  };

  return {
    update,
    stencil,
    dispose: () => {
      clear();
      quad.dispose();
      tiny.dispose();
    },
  };
}
