// Section caps: the cut faces filled in, so a section reads like Onshape's (solid, each part in its
// own colour darkened) instead of showing the lit inside of the parts.
//
// With a stencil buffer (the renderer asked for one): the classic stencil capping, per cut plane
// and per cut part. The part's back faces count +1 and its front faces -1 into the stencil's low 7
// bits (clipped by that plane only), so a pixel ends with the number of solids of that part the
// plane runs through there; then a quad on the plane draws the cap there. Red is Onshape's
// interference: a count of 2 or more is two copies of the part overlapping, and the stencil's top
// bit remembers "a cap is already here", so another part's cap over it is red too.
// Without a stencil: each cut part's back faces are drawn flat in the cap colour, which reads
// almost the same from most angles (no red then).
import * as THREE from "three";
import { clipPlane, contour, planeAt, type Cut } from "./sectionMath";
import { EDGE } from "./paint";
import type { Stage } from "./stage";
import type { PartMesh } from "./types";

const CLIP = `uniform vec4 clip[3];
uniform int clipN;
bool clipped(vec3 p, int k) {
  return dot(clip[k].xyz, p) + clip[k].w < 0.0;
}
bool clippedBut(vec3 p, int skip) {
  for (int k = 0; k < 3; k++) {
    if (k >= clipN) break;
    if (k != skip && clipped(p, k)) return true;
  }
  return false;
}`;

const VERT = `#include <common>
varying vec3 vWorld;
varying vec3 vColor;
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
// `counting`: the stencil pass, clipped by its own plane (`own`) only; else a cap, clipped by
// every other plane.
const FRAG = `#include <common>
${CLIP}
uniform int own;
uniform float counting;
uniform vec3 color;
uniform float shade;
uniform float hatch;
uniform float dpr;
varying vec3 vWorld;
varying vec3 vColor;
void main() {
  if (counting > 0.5 ? clipped(vWorld, own) : clippedBut(vWorld, own)) discard;
  #ifdef USE_INSTANCING_COLOR
  vec3 base = vColor * shade;
  #else
  vec3 base = color * shade;
  #endif
  // Onshape's hatch: thin 45° lines about 8.5 px apart on screen, dark on a light cap and light
  // on a dark one, steady at any zoom.
  if (hatch > 0.5 && mod(gl_FragCoord.x + gl_FragCoord.y, 12.0 * dpr) < 1.4 * dpr) {
    float l = dot(base, vec3(0.2126, 0.7152, 0.0722));
    base = l > 0.12 ? base * 0.35 : mix(base, vec3(1.0), 0.5);
  }
  gl_FragColor = vec4(base, 1.0);
  #include <colorspace_fragment>
}`;

// The cap colour: the part's own, a bit darker, like Onshape's (Harel, 2026-11-11).
const SHADE = 0.8;
// The outline round each cut face is worked out on the CPU, a moment after the cut stops moving
// (dragging the handle redoes the caps on every move).
const CONTOUR_MS = 120;
export const INTERFERENCE = "#ff2a2a";

export type Caps = {
  // The cut planes (model frame) and the matrix from the model frame to the world (root's).
  update: (cuts: Cut[], toWorld: THREE.Matrix4) => void;
  stencil: boolean;
  dispose: () => void;
};

export function createCaps(stage: Stage, meshes: PartMesh[]): Caps {
  const { renderer } = stage;
  const stencil = !!renderer.getContext().getContextAttributes()?.stencil;
  const made: THREE.Object3D[] = [];
  const materials: THREE.ShaderMaterial[] = [];
  // Every cap material reads the same cut arrays.
  const planes = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  const count = { value: 0 };
  const dpr = { value: renderer.getPixelRatio() };
  const outlineLook = new THREE.LineBasicMaterial({ color: EDGE });
  const capMaterial = (own: number, counting: boolean, extra: THREE.ShaderMaterialParameters) => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        clip: { value: planes },
        clipN: count,
        own: { value: own },
        counting: { value: counting ? 1 : 0 },
        color: { value: new THREE.Color() },
        shade: { value: 1 },
        hatch: { value: counting ? 0 : 1 },
        dpr,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      ...extra,
    });
    materials.push(m);
    return m;
  };
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
  const meets = (box: THREE.Box3, c: Cut) => {
    if (box.isEmpty()) return false;
    const { point, normal } = planeAt(c);
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point).intersectsBox(box);
  };

  const onFrame = () => {
    dpr.value = renderer.getPixelRatio(); // phones draw at 1 while the view moves
  };
  stage.beforeRender.push(onFrame);

  let outlines: THREE.LineSegments[] = [];
  let outlineTimer = 0;
  const clearOutlines = () => {
    clearTimeout(outlineTimer);
    for (const o of outlines) {
      o.removeFromParent();
      o.geometry.dispose();
    }
    outlines = [];
  };
  // Each cut part's outline, under its mesh (so it hides with it), from every shown copy.
  const drawOutlines = (cuts: Cut[]) => {
    const at = new THREE.Matrix4();
    const copyBox = new THREE.Box3();
    meshes.forEach((pm) => {
      if (pm.sketch) return; // a sketch has no faces to cut
      const box = meshBox(pm);
      const g = pm.mesh.geometry;
      if (!g.index) return;
      const pos = g.getAttribute("position").array;
      const out: number[] = [];
      cuts.forEach((c, k) => {
        if (!meets(box, c)) return;
        for (let i = 0; i < pm.mesh.count; i++) {
          pm.mesh.getMatrixAt(i, at);
          if (Math.abs(at.determinant()) < 1e-12) continue; // hidden copy
          if (!g.boundingBox) g.computeBoundingBox();
          if (!meets(copyBox.copy(g.boundingBox!).applyMatrix4(at), c)) continue;
          contour(pos, g.index!.array, at, c, cuts.filter((_, j) => j !== k), out);
        }
      });
      if (!out.length) return;
      const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(out, 3)), outlineLook);
      lines.frustumCulled = false;
      lines.raycast = () => {};
      lines.renderOrder = 900000; // after the caps
      pm.mesh.add(lines);
      outlines.push(lines);
    });
    stage.render();
  };

  const clear = () => {
    clearOutlines();
    for (const o of made) {
      o.removeFromParent();
      (o.userData.dispose as THREE.Material | undefined)?.dispose();
    }
    made.length = 0;
    materials.forEach((m) => m.dispose());
    materials.length = 0;
  };

  const update: Caps["update"] = (cuts, toWorld) => {
    clear();
    cuts.slice(0, 3).forEach((c, k) => {
      const w = clipPlane(c).applyMatrix4(toWorld);
      planes[k].set(w.normal.x, w.normal.y, w.normal.z, w.constant);
    });
    count.value = Math.min(3, cuts.length);
    if (!cuts.length) return;
    outlineTimer = window.setTimeout(() => drawOutlines(cuts), CONTOUR_MS);
    if (!stencil) {
      // Flat back faces, cut by every cut like the parts.
      const back = capMaterial(-1, false, { side: THREE.BackSide });
      back.uniforms.shade.value = SHADE;
      meshes.forEach((pm) => {
        if (!pm.sketch && cuts.some((c) => meets(meshBox(pm), c))) twin(pm, back, 0);
      });
      return;
    }
    cuts.forEach((c, k) => {
      const counting = (side: THREE.Side, op: THREE.StencilOp) =>
        capMaterial(k, true, { side, colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilWriteMask: 0x7f, stencilFail: op, stencilZFail: op, stencilZPass: op });
      const back = counting(THREE.BackSide, THREE.IncrementWrapStencilOp);
      const front = counting(THREE.FrontSide, THREE.DecrementWrapStencilOp);
      const stamp = { stencilWrite: true, stencilWriteMask: 0xff, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp, side: THREE.DoubleSide };
      // Two or more of this part's copies here (low bits ≥ 2): red, leaving 0x82, which the next
      // one (any stencil above 0x80: another part's cap already here) turns red too and back to
      // 0x80. Then the part's own colour where its count is 1. Each leaves 0x80: "a cap here".
      const redCopies = capMaterial(k, false, { ...stamp, stencilRef: 0x82, stencilFunc: THREE.LessEqualStencilFunc, stencilFuncMask: 0x7f });
      const redOthers = capMaterial(k, false, { ...stamp, stencilRef: 0x80, stencilFunc: THREE.LessStencilFunc, stencilFuncMask: 0xff });
      const fill = capMaterial(k, false, { ...stamp, stencilRef: 0x80, stencilFunc: THREE.NotEqualStencilFunc, stencilFuncMask: 0x7f });
      redCopies.uniforms.color.value.set(INTERFERENCE);
      redOthers.uniforms.color.value.set(INTERFERENCE);
      fill.uniforms.shade.value = SHADE;
      const caps = [redCopies, redOthers, fill];

      const base = 1000 + k * 200000;
      if (k > 0) {
        // Each cut starts from a clean stencil.
        const wipeLook = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false });
        const wipe = new THREE.Mesh(tiny, wipeLook);
        wipe.frustumCulled = false;
        wipe.renderOrder = base - 1;
        wipe.onBeforeRender = (r) => r.clearStencil();
        stage.root.add(wipe);
        made.push(wipe);
        wipe.userData.dispose = wipeLook;
      }
      const at = planeAt(c);
      meshes.forEach((pm, m) => {
        if (pm.sketch) return; // no cap for a sketch
        const box = meshBox(pm);
        if (!meets(box, c)) return;
        const order = base + m * 5;
        twin(pm, back, order);
        twin(pm, front, order + 1);
        // The quad, on the plane, big enough to cover the part's copies.
        const size = box.getSize(new THREE.Vector3()).length() * 1.05;
        const centre = box.getCenter(new THREE.Vector3());
        const p = centre.addScaledVector(at.normal, -centre.clone().sub(at.point).dot(at.normal));
        const u = (Math.abs(at.normal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).cross(at.normal).normalize();
        const v = new THREE.Vector3().crossVectors(at.normal, u);
        const place = new THREE.Matrix4().makeBasis(u.multiplyScalar(size), v.multiplyScalar(size), at.normal).setPosition(p);
        caps.forEach((mat, n) => {
          const cap = new THREE.Mesh(quad, mat);
          cap.matrix.copy(place);
          cap.matrixAutoUpdate = false;
          cap.frustumCulled = false;
          cap.renderOrder = order + 2 + n;
          cap.raycast = () => {};
          if (mat === fill) {
            // The part's colour now (paint.ts may have changed it since): its first copy's.
            cap.onBeforeRender = () => {
              const col = pm.mesh.instanceColor;
              if (col) fill.uniforms.color.value.setRGB(col.getX(0), col.getY(0), col.getZ(0));
              else fill.uniforms.color.value.set("#9aa1ad");
              fill.uniformsNeedUpdate = true;
            };
          }
          pm.mesh.add(cap);
          made.push(cap);
        });
      });
    });
  };

  return {
    update,
    stencil,
    dispose: () => {
      clear();
      const i = stage.beforeRender.indexOf(onFrame);
      if (i >= 0) stage.beforeRender.splice(i, 1);
      quad.dispose();
      outlineLook.dispose();
      tiny.dispose();
    },
  };
}
