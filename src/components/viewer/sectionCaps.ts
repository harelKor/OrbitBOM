// Section caps: the cut faces filled in, so a section reads like Onshape's (solid, each part in its
// own colour darkened) instead of showing the lit inside of the parts.
//
// With a stencil buffer (the renderer asked for one): the classic stencil capping, per cut and per
// cut part. The part's back faces count +1 and its front faces -1 into the stencil's low 7 bits,
// drawn only beyond the cut surface along each line of sight, so a pixel ends with the number of
// solids of that part the cut surface runs through there; then the cap surface (a quad on a plane,
// a tube on a cylinder) draws there. Red is Onshape's interference: a count of 2 or more is two
// copies of the part overlapping, and the stencil's top bit remembers "a cap is already here", so
// another part's cap over it is red too.
// Without a stencil: each cut part's back faces are drawn flat in the cap colour, which reads
// almost the same from most angles (no red then).
//
// A cylinder's surface meets each line of sight twice. The cap that shows is at the near crossing
// when the outside is cut away (the inside kept) and at the far one when the inside is cut away;
// a plane through the axis, square to the view (sectionMath's splitPlane, set every frame), tells
// the two apart, and the counting only runs beyond the crossing that shows.
import * as THREE from "three";
import { axisSpan, clipPlane, contour, cylinderMeetsBox, cylinderRadius, isCylinder, planeAt, splitPlane, type Cut } from "./sectionMath";
import { EDGE } from "./paint";
import type { Stage } from "./stage";
import type { PartMesh } from "./types";

// The cuts as the shaders get them, up to 3: A = a plane's (normal, constant) or a cylinder's
// (axis point, radius); B.w = 2 for a plane, else the cylinder's axis and 1 when its outside is
// cut away, 0 when its inside is. `prefix` names the uniforms (each set of shaders has its own).
export function cutGlsl(prefix: string) {
  return `uniform vec4 ${prefix}A[3];
uniform vec4 ${prefix}B[3];
uniform int ${prefix}N;
bool ${prefix}Removed(vec3 p, int k) {
  vec4 a = ${prefix}A[k];
  vec4 b = ${prefix}B[k];
  if (b.w > 1.5) return dot(a.xyz, p) + a.w < 0.0;
  vec3 d = p - a.xyz;
  float t = dot(d, b.xyz);
  float r2 = dot(d, d) - t * t;
  return b.w > 0.5 ? r2 > a.w * a.w : r2 < a.w * a.w;
}
bool ${prefix}Cut(vec3 p, int skip) {
  for (int k = 0; k < 3; k++) {
    if (k >= ${prefix}N) break;
    if (k != skip && ${prefix}Removed(p, k)) return true;
  }
  return false;
}`;
}

// One cut in a frame (world, or view for the parts' shaders).
export type FrameCut = { plane: THREE.Plane } | { point: THREE.Vector3; axis: THREE.Vector3; r: number; outside: boolean };
// The cylinders' edge sits 0.01 mm into the removed side, like the planes' (sectionMath's EPS).
const EPS = 1e-5;

// A cut in the frame `m` maps the model frame into.
export function frameCut(c: Cut, m: THREE.Matrix4): FrameCut {
  if (!isCylinder(c)) return { plane: clipPlane(c).applyMatrix4(m) };
  const scale = new THREE.Vector3().setFromMatrixScale(m).x;
  return {
    point: new THREE.Vector3(...c.origin).applyMatrix4(m),
    axis: new THREE.Vector3(...c.axis).transformDirection(m),
    r: cylinderRadius(c) * scale,
    outside: c.flip,
  };
}

export function packCuts(cuts: FrameCut[], a: THREE.Vector4[], b: THREE.Vector4[]): number {
  cuts.slice(0, 3).forEach((c, k) => {
    if ("plane" in c) {
      a[k].set(c.plane.normal.x, c.plane.normal.y, c.plane.normal.z, c.plane.constant);
      b[k].set(0, 0, 0, 2);
    } else {
      a[k].set(c.point.x, c.point.y, c.point.z, c.outside ? c.r + EPS : Math.max(0, c.r - EPS));
      b[k].set(c.axis.x, c.axis.y, c.axis.z, c.outside ? 1 : 0);
    }
  });
  return Math.min(3, cuts.length);
}

const vec4s = () => [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];

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
// mode 0: drawn where no other cut (`own` is this cap's) takes it, on one half of a cylinder
// (`capHalf`: 1 the near half, -1 the far one); 1: counting beyond a plane; 2: counting beyond a
// cylinder's near crossing (its outside cut away); 3: beyond its far crossing (inside cut away).
const FRAG = `#include <common>
${cutGlsl("sec")}
uniform int own;
uniform float mode;
uniform float capHalf;
uniform vec4 split;
uniform vec3 color;
uniform float shade;
uniform float hatch;
uniform float dpr;
varying vec3 vWorld;
varying vec3 vColor;
void main() {
  bool near = dot(split.xyz, vWorld) + split.w > 0.0;
  if (mode < 0.5) {
    if (secCut(vWorld, own)) discard;
    if (capHalf > 0.5 && !near) discard;
    if (capHalf < -0.5 && near) discard;
  } else if (mode < 1.5) {
    if (secRemoved(vWorld, own)) discard;
  } else if (mode < 2.5) {
    if (secRemoved(vWorld, own) && near) discard;
  } else {
    if (secRemoved(vWorld, own) || near) discard;
  }
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
  // The cuts (model frame) and the matrix from the model frame to the world (root's).
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
  const A = vec4s(), B = vec4s();
  const count = { value: 0 };
  const dpr = { value: renderer.getPixelRatio() };
  const outlineLook = new THREE.LineBasicMaterial({ color: EDGE });
  const capMaterial = (own: number, mode: number, extra: THREE.ShaderMaterialParameters) => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        secA: { value: A },
        secB: { value: B },
        secN: count,
        own: { value: own },
        mode: { value: mode },
        capHalf: { value: 0 },
        split: { value: new THREE.Vector4(0, 0, 0, 1) },
        color: { value: new THREE.Color() },
        shade: { value: 1 },
        hatch: { value: mode === 0 ? 1 : 0 },
        dpr,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      ...extra,
    });
    m.userData.noSection = true; // section.ts doesn't add its cylinder clip to these
    materials.push(m);
    return m;
  };
  const quad = new THREE.PlaneGeometry(1, 1);
  const tube = new THREE.CylinderGeometry(1, 1, 1, 128, 1, true);
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
    if (isCylinder(c)) return cylinderMeetsBox(c, box);
    const { point, normal } = planeAt(c);
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point).intersectsBox(box);
  };

  // Each cylinder's split plane follows the camera (world frame).
  let splits: { k: number; point: THREE.Vector3; axis: THREE.Vector3; users: THREE.ShaderMaterial[] }[] = [];
  const plane = new THREE.Plane();
  const toCamera = new THREE.Vector3();
  const onFrame = () => {
    dpr.value = renderer.getPixelRatio(); // phones draw at 1 while the view moves
    if (!splits.length) return;
    const cam = stage.camera;
    cam.updateMatrixWorld();
    for (const s of splits) {
      if (cam.ortho) toCamera.set(0, 0, 1).transformDirection(cam.matrixWorld);
      else toCamera.setFromMatrixPosition(cam.matrixWorld).sub(s.point);
      splitPlane(s.point, s.axis, toCamera, plane);
      for (const m of s.users) (m.uniforms.split.value as THREE.Vector4).set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    }
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
    splits = [];
  };

  const update: Caps["update"] = (cuts, toWorld) => {
    clear();
    count.value = packCuts(
      cuts.map((c) => frameCut(c, toWorld)),
      A,
      B,
    );
    if (!cuts.length) return;
    outlineTimer = window.setTimeout(() => drawOutlines(cuts), CONTOUR_MS);
    if (!stencil) {
      // Flat back faces, cut by every cut like the parts.
      const back = capMaterial(-1, 0, { side: THREE.BackSide });
      back.uniforms.shade.value = SHADE;
      meshes.forEach((pm) => {
        if (cuts.some((c) => meets(meshBox(pm), c))) twin(pm, back, 0);
      });
      return;
    }
    cuts.forEach((c, k) => {
      const cyl = isCylinder(c);
      const mode = !cyl ? 1 : c.flip ? 2 : 3;
      const counting = (side: THREE.Side, op: THREE.StencilOp) =>
        capMaterial(k, mode, { side, colorWrite: false, depthWrite: false, depthTest: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilWriteMask: 0x7f, stencilFail: op, stencilZFail: op, stencilZPass: op });
      const back = counting(THREE.BackSide, THREE.IncrementWrapStencilOp);
      const front = counting(THREE.FrontSide, THREE.DecrementWrapStencilOp);
      const stamp = { stencilWrite: true, stencilWriteMask: 0xff, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp, side: THREE.DoubleSide };
      // Two or more of this part's copies here (low bits ≥ 2): red, leaving 0x82, which the next
      // one (any stencil above 0x80: another part's cap already here) turns red too and back to
      // 0x80. Then the part's own colour where its count is 1. Each leaves 0x80: "a cap here".
      const redCopies = capMaterial(k, 0, { ...stamp, stencilRef: 0x82, stencilFunc: THREE.LessEqualStencilFunc, stencilFuncMask: 0x7f });
      const redOthers = capMaterial(k, 0, { ...stamp, stencilRef: 0x80, stencilFunc: THREE.LessStencilFunc, stencilFuncMask: 0xff });
      const fill = capMaterial(k, 0, { ...stamp, stencilRef: 0x80, stencilFunc: THREE.NotEqualStencilFunc, stencilFuncMask: 0x7f });
      redCopies.uniforms.color.value.set(INTERFERENCE);
      redOthers.uniforms.color.value.set(INTERFERENCE);
      fill.uniforms.shade.value = SHADE;
      const caps = [redCopies, redOthers, fill];
      if (cyl) {
        for (const m of caps) m.uniforms.capHalf.value = c.flip ? 1 : -1;
        const w = frameCut(c, toWorld) as Extract<FrameCut, { axis: THREE.Vector3 }>;
        splits.push({ k, point: w.point, axis: w.axis, users: [back, front, ...caps] });
      }

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
      const at = !cyl ? planeAt(c) : null;
      meshes.forEach((pm, m) => {
        const box = meshBox(pm);
        if (!meets(box, c)) return;
        const order = base + m * 5;
        twin(pm, back, order);
        twin(pm, front, order + 1);
        // The cap surface, big enough to cover the part's copies.
        let geometry: THREE.BufferGeometry = quad;
        const place = new THREE.Matrix4();
        if (at) {
          const size = box.getSize(new THREE.Vector3()).length() * 1.05;
          const centre = box.getCenter(new THREE.Vector3());
          const p = centre.addScaledVector(at.normal, -centre.clone().sub(at.point).dot(at.normal));
          const u = (Math.abs(at.normal.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).cross(at.normal).normalize();
          const v = new THREE.Vector3().crossVectors(at.normal, u);
          place.makeBasis(u.multiplyScalar(size), v.multiplyScalar(size), at.normal).setPosition(p);
        } else if (isCylinder(c)) {
          geometry = tube;
          const r = cylinderRadius(c);
          const axis = new THREE.Vector3(...c.axis);
          const ref = new THREE.Vector3(...c.ref);
          const span = axisSpan(c.origin, c.axis, box);
          place.makeBasis(ref.clone().multiplyScalar(r), axis.multiplyScalar(span.length), ref.cross(new THREE.Vector3(...c.axis)).multiplyScalar(r)).setPosition(span.centre);
        }
        caps.forEach((mat, n) => {
          const cap = new THREE.Mesh(geometry, mat);
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
      tube.dispose();
      outlineLook.dispose();
      tiny.dispose();
    },
  };
}
