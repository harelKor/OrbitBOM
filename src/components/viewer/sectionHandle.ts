// The section's 3D handle, like Onshape's manipulator: an arrow along the plane's normal to drag
// the offset (a click on it flips the cut) and two arcs to tilt it; on a cylinder only the arrow,
// pointing out from the axis, to drag the radius. Drawn on top of everything at a fixed size on screen
// (whatever the zoom, in either camera), never clipped by the section itself.
import * as THREE from "three";
import type { Stage } from "./stage";

export type HandlePart = "move" | "u" | "v";
// The plane's frame in the model: its point and three unit axes (u, v in the plane, n its normal).
// `arcs`: false on a cylinder (no tilt).
export type Frame = { point: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; n: THREE.Vector3; arcs: boolean };

// Sizes in CSS pixels.
const SHAFT = 56;
const TIP = 18;
const RING = 44;
// Each arc spans this much either side of the plane (radians), like Onshape's short arcs.
const ARC = 0.6;
const COLORS: Record<HandlePart, string> = { move: "#2f80ff", u: "#ff8a1f", v: "#19b37a" };
const LIT = "#ffffff";

const VERT = `uniform float px;
void main() {
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = 2.0 / (projectionMatrix[1][1] * px) * (projectionMatrix[3][3] == 0.0 ? -c.z : 1.0);
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(position * s, 1.0));
}`;
const FRAG = `uniform vec3 color;
void main() {
  gl_FragColor = vec4(color, 0.95);
  #include <colorspace_fragment>
}`;

export type Handle = {
  set: (f: Frame | null) => void;
  // The part of the handle under a pointer (client px), within a few px (more for a finger).
  hit: (x: number, y: number, finger: boolean) => HandlePart | null;
  // Where the arrow's tip is on screen (CSS px from the view's top left), for the number box.
  anchor: () => [number, number] | null;
  lit: (part: HandlePart | null) => void;
  ray: (x: number, y: number) => THREE.Ray; // the pointer's ray, in the model frame
  dispose: () => void;
};

export function createHandle(stage: Stage): Handle {
  const { root } = stage;
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.visible = false;
  root.add(group);
  const geometries: THREE.BufferGeometry[] = [];
  const mats = {} as Record<HandlePart, THREE.ShaderMaterial>;
  for (const part of ["move", "u", "v"] as HandlePart[]) {
    mats[part] = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(COLORS[part]) }, px: { value: 600 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      transparent: true,
    });
  }
  const arcs: THREE.Mesh[] = [];
  const add = (g: THREE.BufferGeometry, part: HandlePart) => {
    geometries.push(g);
    const m = new THREE.Mesh(g, mats[part]);
    m.renderOrder = 20;
    m.frustumCulled = false;
    m.raycast = () => {};
    m.onBeforeRender = () => {
      mats[part].uniforms.px.value = Math.max(1, stage.el.clientHeight);
    };
    group.add(m);
    if (part !== "move") arcs.push(m);
  };
  // Built along +Y, then turned so the arrow runs along the frame's n (+Z).
  add(new THREE.CylinderGeometry(2, 2, SHAFT, 10).translate(0, SHAFT / 2, 0).rotateX(Math.PI / 2), "move");
  add(new THREE.ConeGeometry(7, TIP, 18).translate(0, SHAFT + TIP / 2, 0).rotateX(Math.PI / 2), "move");
  add(new THREE.SphereGeometry(4.5, 14, 10), "move");
  // The arcs, in the frame (x = u, y = v, z = n): about u through +v, about v through +u, each with
  // a small cone at both ends like Onshape's curved arrows.
  const arcGeoms = (a: THREE.Vector3, b: THREE.Vector3) => {
    const at = (t: number) => a.clone().multiplyScalar(Math.cos(t) * RING).addScaledVector(b, Math.sin(t) * RING);
    const curve = new THREE.CatmullRomCurve3(Array.from({ length: 13 }, (_, k) => at(-ARC + (k / 12) * 2 * ARC)));
    const out: THREE.BufferGeometry[] = [new THREE.TubeGeometry(curve, 24, 2, 6)];
    for (const end of [-1, 1]) {
      const t = end * ARC;
      const tangent = a.clone().multiplyScalar(-Math.sin(t)).addScaledVector(b, Math.cos(t)).multiplyScalar(end).normalize();
      const cone = new THREE.ConeGeometry(5, 12, 12).translate(0, 6, 0);
      cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent));
      out.push(cone.translate(...at(t).toArray()));
    }
    return out;
  };
  const [X, Y, Z] = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  for (const g of arcGeoms(Y, Z)) add(g, "u");
  for (const g of arcGeoms(X, Z)) add(g, "v");

  let frame: Frame | null = null;
  const set = (f: Frame | null) => {
    frame = f;
    group.visible = !!f;
    for (const m of arcs) m.visible = !!f?.arcs;
    if (f) group.matrix.makeBasis(f.u, f.v, f.n).setPosition(f.point);
    group.matrixWorldNeedsUpdate = true;
  };

  // Screen position (CSS px from the canvas's top left) of a model-frame point.
  const screen = (q: THREE.Vector3, rect: DOMRect) => {
    const p = q.clone().applyMatrix4(root.matrixWorld).project(stage.camera);
    return [((p.x + 1) / 2) * rect.width + rect.left, ((1 - p.y) / 2) * rect.height + rect.top] as const;
  };
  // Model units per CSS pixel at the handle.
  const perPx = (at: THREE.Vector3, rect: DOMRect) => {
    const cam = stage.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    cam.updateMatrixWorld();
    const view = at.clone().applyMatrix4(root.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
    const p11 = cam.projectionMatrix.elements[5];
    const ortho = cam.projectionMatrix.elements[15] !== 0;
    return (2 / (p11 * rect.height)) * (ortho ? 1 : -view.z);
  };
  const toSeg = (x: number, y: number, a: readonly [number, number], b: readonly [number, number]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    return Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
  };
  const hit = (x: number, y: number, finger: boolean): HandlePart | null => {
    if (!frame) return null;
    const rect = stage.renderer.domElement.getBoundingClientRect();
    const s = perPx(frame.point, rect);
    if (!(s > 0)) return null;
    const reach = finger ? 22 : 9;
    const c = screen(frame.point, rect);
    const tip = screen(frame.point.clone().addScaledVector(frame.n, (SHAFT + TIP) * s), rect);
    let best = reach;
    let part: HandlePart | null = null;
    const dm = Math.min(toSeg(x, y, c, tip), Math.hypot(x - c[0], y - c[1]) - 4);
    if (dm < best) [best, part] = [dm, "move"];
    if (!frame.arcs) return part;
    for (const [name, a, b] of [
      ["u", frame.v, frame.n],
      ["v", frame.u, frame.n],
    ] as const) {
      const pts = Array.from({ length: 13 }, (_, k) => {
        const t = -ARC + (k / 12) * 2 * ARC;
        return screen(frame!.point.clone().addScaledVector(a, Math.cos(t) * RING * s).addScaledVector(b, Math.sin(t) * RING * s), rect);
      });
      for (let k = 0; k < 12; k++) {
        const d = toSeg(x, y, pts[k], pts[k + 1]);
        if (d < best) [best, part] = [d, name];
      }
    }
    return part;
  };
  const anchor = (): [number, number] | null => {
    if (!frame) return null;
    const rect = stage.renderer.domElement.getBoundingClientRect();
    const s = perPx(frame.point, rect);
    if (!(s > 0)) return null;
    const [x, y] = screen(frame.point.clone().addScaledVector(frame.n, (SHAFT + TIP) * s), rect);
    return [x - rect.left, y - rect.top];
  };
  const lit = (part: HandlePart | null) => {
    for (const p of ["move", "u", "v"] as HandlePart[]) mats[p].uniforms.color.value.set(p === part ? LIT : COLORS[p]);
  };
  const ray = (x: number, y: number) => {
    const rect = stage.renderer.domElement.getBoundingClientRect();
    const r = new THREE.Raycaster();
    r.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1)), stage.camera);
    return r.ray.clone().applyMatrix4(root.matrixWorld.clone().invert());
  };
  return {
    set,
    hit,
    anchor,
    lit,
    ray,
    dispose: () => {
      group.removeFromParent();
      geometries.forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
  };
}
