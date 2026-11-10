// The section, like Onshape's section view: up to 3 planes (each cuts), each across an axis through
// the model centre or on a picked flat face, moved in mm and tilted, from the toolbar or with a 3D
// handle; the cut faces filled (sectionCaps.ts); every part cut, only the picked ones, or all but
// them. The plane maths is in sectionMath.ts.
import * as THREE from "three";
import type { V3 } from "@/lib/model/topology";
import type { Pick, Topo } from "./picking";
import { createCaps } from "./sectionCaps";
import { createHandle, type HandlePart } from "./sectionHandle";
import { alongLine, axisPlane, clipPlane, facePlane, inPlaneAxes, MAX_PLANES, offsetRange, planeAt, ringAngle, wrapDeg, type Axis, type CutPlane, type Section, type SectionParts } from "./sectionMath";
import type { Stage } from "./stage";
import type { PartMesh } from "./types";

export type { Axis, CutPlane, Section, SectionParts };
export { MAX_PLANES };

// What the toolbar shows: the section, the row the handle is on, each plane's slider ends (mm),
// whether a flat face is picked (to section from it) and how many parts are picked.
export type SectionView = Section & { active: number; ranges: [number, number][]; face: boolean; picked: number; caps: "stencil" | "flat" };

export type SectionTools = {
  section: (s: Section | null) => void; // the whole section at once (null: off); S6 restores a saved view with it
  sectionNow: () => Section | null;
  // "Section here" (S3's context menu): one plane on a flat face, its point and outward normal in
  // the model frame (Onshape's, metres), replacing any planes there were.
  sectionFromFace: (point: V3, normal: V3) => void;
  // A plane across an axis, or on the newest picked flat face: in row `row`, or added (up to 3).
  sectionPlane: (from: Axis | "face", row?: number) => void;
  sectionParts: (parts: SectionParts) => void; // only / except: the parts picked now
  sectionActive: (row: number) => void; // the row the 3D handle is on
  onSection: (cb: (v: SectionView | null) => void) => () => void;
};

export type SectionLayer = {
  tools: SectionTools;
  picked: (parts: string[], newest: Pick | null) => void; // the measure picks changed
  dispose: () => void;
};

export function createSection(stage: Stage, meshes: PartMesh[], topo: Topo): SectionLayer {
  const { renderer, root, render } = stage;
  const caps = createCaps(stage, meshes);
  const handle = createHandle(stage);
  let state: Section | null = null;
  let active = 0;
  let parts: string[] = [];
  let face: { point: V3; normal: V3 } | null = null;
  const listeners = new Set<(v: SectionView | null) => void>();

  // The model's box in its own frame (the meshes sit at identity under root).
  const modelBox = () => {
    const box = new THREE.Box3();
    for (const { mesh } of meshes) {
      if (!mesh.boundingBox) mesh.computeBoundingBox();
      box.union(mesh.boundingBox!);
    }
    return box;
  };

  // Include / Exclude: the renderer-wide planes cut everything, so then each part material gets the
  // planes itself, set just before each part draws (the materials are shared between parts).
  const hooked: THREE.Object3D[] = [];
  const unhook = () => {
    for (const o of hooked) {
      o.onBeforeRender = THREE.Object3D.prototype.onBeforeRender;
      const mat = (o as THREE.Mesh).material as THREE.Material;
      if (mat) mat.clippingPlanes = null;
    }
    hooked.length = 0;
    renderer.localClippingEnabled = false;
  };
  const hook = (o: THREE.Object3D, planes: THREE.Plane[] | null) => {
    o.onBeforeRender = (r, _s, _c, _g, material) => {
      material.clippingPlanes = planes;
      // three.js reuses a material's last projected planes when the same material draws twice in a
      // row; a part drawn uncut in between would leave them stale.
      if (planes) (r.properties.get(material) as { clippingState?: unknown }).clippingState = null;
    };
    hooked.push(o);
  };

  const view = (): SectionView | null =>
    state && {
      ...state,
      active,
      ranges: state.planes.map((p) => offsetRange(p, modelBox())),
      face: !!face,
      picked: parts.length,
      caps: caps.stencil ? "stencil" : "flat",
    };
  const emit = () => {
    const v = view();
    listeners.forEach((cb) => cb(v));
  };

  const apply = () => {
    unhook();
    if (!state || !state.planes.length) {
      state = null;
      renderer.clippingPlanes = [];
      caps.update([], [], () => false);
      handle.set(null);
      render();
      emit();
      return;
    }
    root.updateMatrixWorld();
    active = Math.min(active, state.planes.length - 1);
    const model = state.planes.map(planeAt);
    const world = state.planes.map((p) => clipPlane(p).applyMatrix4(root.matrixWorld));
    const chosen = new Set(state.keys);
    const isCut = (m: number) => state!.parts === "all" || meshes[m].keys.some((k) => chosen.has(k)) === (state!.parts === "only");
    if (state.parts === "all") renderer.clippingPlanes = world;
    else {
      renderer.clippingPlanes = [];
      renderer.localClippingEnabled = true;
      meshes.forEach(({ mesh }, m) => {
        const planes = isCut(m) ? world : null;
        hook(mesh, planes);
        for (const c of mesh.children) if ((c as THREE.LineSegments).isLineSegments) hook(c, planes);
      });
    }
    caps.update(world, model, isCut);
    // The handle on the active plane, its rings turned with the plane.
    const p = state.planes[active];
    const base = new THREE.Vector3(...p.normal).normalize();
    const [u0, v0] = inPlaneAxes(base);
    const q = new THREE.Quaternion().setFromAxisAngle(v0, (p.tilt[1] * Math.PI) / 180).multiply(new THREE.Quaternion().setFromAxisAngle(u0, (p.tilt[0] * Math.PI) / 180));
    handle.set({ point: model[active].point, n: model[active].normal, u: u0.clone().applyQuaternion(q), v: v0.clone().applyQuaternion(q) });
    render();
    emit();
  };

  const section = (s: Section | null) => {
    state = s && { ...s, planes: s.planes.slice(0, MAX_PLANES) };
    apply();
  };
  const sectionFromFace = (point: V3, normal: V3) => {
    active = 0;
    section({ planes: [facePlane(point, normal)], parts: "all", keys: [] });
  };
  const sectionPlane = (from: Axis | "face", row?: number) => {
    let plane: CutPlane;
    if (from === "face") {
      if (!face) return;
      plane = facePlane(face.point, face.normal);
    } else plane = axisPlane(from, modelBox());
    const planes = [...(state?.planes ?? [])];
    if (row !== undefined && row < planes.length) planes[row] = plane;
    else if (planes.length < MAX_PLANES) planes.push(plane);
    else return;
    active = row !== undefined && row < planes.length ? row : planes.length - 1;
    section({ planes, parts: state?.parts ?? "all", keys: state?.keys ?? [] });
  };
  const sectionParts = (p: SectionParts) => {
    if (!state) return;
    section({ ...state, parts: p, keys: p === "all" ? [] : [...parts] });
  };
  const sectionActive = (row: number) => {
    active = row;
    apply();
  };

  // The newest pick, when it is a flat face: its plane in the model frame.
  const picked = (keys: string[], newest: Pick | null) => {
    parts = keys;
    face = null;
    if (newest?.kind === "face") {
      const f = topo.topoOf(newest.m).faces[newest.n];
      if (f.kind === "plane" && f.normal) {
        const at = topo.placeOf(newest.m, newest.i);
        // The plane's origin (and the handle) at the middle of the face, not one of its corners.
        const g = meshes[newest.m].mesh.geometry;
        const idx = g.index!.array;
        const pos = g.getAttribute("position") as THREE.BufferAttribute;
        const point = new THREE.Vector3();
        const q = new THREE.Vector3();
        for (const t of f.tris) for (let k = 0; k < 3; k++) point.add(q.fromBufferAttribute(pos, idx[t * 3 + k]));
        point.divideScalar(f.tris.length * 3).applyMatrix4(at);
        const normal = new THREE.Vector3(...f.normal).applyMatrix3(new THREE.Matrix3().getNormalMatrix(at)).normalize();
        face = { point: point.toArray() as V3, normal: normal.toArray() as V3 };
      }
    }
    if (state) emit();
  };

  // Dragging the handle: the arrow moves the plane along its normal (mm), a ring tilts it.
  const canvas = renderer.domElement;
  let drag: { part: HandlePart; id: number; start: CutPlane; t0: number; centre: THREE.Vector3; axis: THREE.Vector3; ref: THREE.Vector3; n: THREE.Vector3 } | null = null;
  const frameOf = () => {
    if (!state) return null;
    const p = state.planes[active];
    const { point, normal } = planeAt(p);
    const base = new THREE.Vector3(...p.normal).normalize();
    const [u0, v0] = inPlaneAxes(base);
    const q = new THREE.Quaternion().setFromAxisAngle(v0, (p.tilt[1] * Math.PI) / 180).multiply(new THREE.Quaternion().setFromAxisAngle(u0, (p.tilt[0] * Math.PI) / 180));
    return { p, point, n: normal, u: u0.applyQuaternion(q), v: v0.applyQuaternion(q) };
  };
  const onDown = (e: PointerEvent) => {
    if (!state || e.button !== 0 || e.target !== canvas) return;
    const part = handle.hit(e.clientX, e.clientY, e.pointerType !== "mouse");
    const f = frameOf();
    if (!part || !f) return;
    const ray = handle.ray(e.clientX, e.clientY);
    const [axis, ref] = part === "u" ? [f.u, f.v] : [f.v, f.n];
    const t0 = part === "move" ? alongLine(ray.origin, ray.direction, f.point, f.n) : ringAngle(ray.origin, ray.direction, f.point, axis, ref);
    if (t0 === null) return;
    // Ours alone: no rotate, no pick.
    e.stopPropagation();
    e.preventDefault();
    drag = { part, id: e.pointerId, start: { ...f.p, tilt: [...f.p.tilt] }, t0, centre: f.point, axis, ref, n: f.n };
    handle.lit(part);
    render();
  };
  let hovered: HandlePart | null = null;
  const onMove = (e: PointerEvent) => {
    if (!drag) {
      // Mouse hover: light the part under the pointer.
      if (state && e.pointerType === "mouse" && !e.buttons && e.target === canvas) {
        const part = handle.hit(e.clientX, e.clientY, false);
        if (part !== hovered) {
          hovered = part;
          handle.lit(part);
          canvas.style.cursor = part ? "grab" : "";
          render();
        }
      }
      return;
    }
    if (e.pointerId !== drag.id || !state) return;
    e.stopPropagation();
    const ray = handle.ray(e.clientX, e.clientY);
    const p: CutPlane = { ...drag.start, tilt: [...drag.start.tilt] };
    if (drag.part === "move") {
      const t = alongLine(ray.origin, ray.direction, drag.centre, drag.n);
      if (t === null) return;
      p.offset = Math.round((drag.start.offset + (t - drag.t0) * 1000) * 10) / 10;
    } else {
      const a = ringAngle(ray.origin, ray.direction, drag.centre, drag.axis, drag.ref);
      if (a === null) return;
      const k = drag.part === "u" ? 0 : 1;
      p.tilt[k] = Math.round(wrapDeg(drag.start.tilt[k] + ((a - drag.t0) * 180) / Math.PI) * 10) / 10;
    }
    const planes = [...state.planes];
    planes[active] = p;
    state = { ...state, planes };
    apply();
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.stopPropagation();
    drag = null;
    hovered = null;
    handle.lit(null);
    render();
  };
  // On the canvas's parent, in the capture phase: before the camera controls and picking see it.
  stage.el.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);

  return {
    tools: {
      section,
      sectionNow: () => state,
      sectionFromFace,
      sectionPlane,
      sectionParts,
      sectionActive,
      onSection: (cb) => {
        listeners.add(cb);
        cb(view());
        return () => {
          listeners.delete(cb);
        };
      },
    },
    picked,
    dispose: () => {
      stage.el.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      unhook();
      renderer.clippingPlanes = [];
      caps.dispose();
      handle.dispose();
      listeners.clear();
    },
  };
}
