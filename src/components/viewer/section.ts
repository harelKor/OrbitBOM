// The section, like Onshape's section view (Harel, 2026-11-11). Shift+X (or the menus) opens the
// "Section view" panel (SectionDialog.tsx); while it is open a click on a flat face adds a plane
// there and a click on a round face a plane through its axis, cutting it lengthwise (Onshape's
// way), up to 3 planes, each cutting; with no face picked a default plane (Front, Top, Right)
// cuts. The 3D handle drags the depth, a click on its arrow flips the cut, its arcs tilt the
// plane, and a number box by it takes the exact value. ✓ closes the panel and keeps the cut (clicks measure
// again); a double-click on a cut face opens it again; Shift+X or "Turn off" ends the section.
// N turns the view square to the newest cut (or to the picked flat face). Every part is cut.
//
// The planes clip through three.js's own clipping planes; the cut faces are filled by
// sectionCaps.ts; the maths is in sectionMath.ts.
import * as THREE from "three";
import type { V3 } from "@/lib/model/topology";
import type { Pick, RoundFace, Topo } from "./picking";
import { createCaps } from "./sectionCaps";
import { createHandle, type Frame, type HandlePart } from "./sectionHandle";
import {
  alongLine,
  clipPlane,
  defaultPlane,
  facePlane,
  inPlaneAxes,
  MAX_PLANES,
  offsetRange,
  planeAt,
  removedBy,
  roundFacePlane,
  ringAngle,
  viewDirection,
  wrapDeg,
  type Axis,
  type Cut,
  type CutPlane,
  type DefaultPlane,
  type Section,
} from "./sectionMath";
import type { Stage } from "./stage";
import type { PartMesh } from "./types";

export type { Axis, Cut, CutPlane, DefaultPlane, Section };
export { MAX_PLANES };

// What the panel shows: the section, the row the handle is on, each cut's slider ends (mm) and
// whether the caps have a stencil buffer.
export type SectionView = Section & { active: number; ranges: [number, number][]; caps: "stencil" | "flat" };

export type SectionTools = {
  section: (s: Section | null) => void; // the whole section at once (null: off); S6 restores a saved view with it
  sectionNow: () => Section | null;
  // The menu's "Section view" on a flat face: its point and outward normal in the model frame
  // (Onshape's, metres). Opens the panel cut there, replacing any cuts there were.
  sectionFromFace: (point: V3, normal: V3) => void;
  // The menu's "Section view" on a round face (picking.ts's RoundFace): opens the panel cut by a
  // plane through its axis, facing the viewer, like Onshape's (Harel, 2026-11-11).
  sectionFromRound: (r: RoundFace) => void;
  // true: open the panel (cutting on the picked flat face, else the Front plane, when nothing is
  // cut yet); false: turn the section off.
  sectionShow: (open: boolean) => void;
  sectionEdit: () => void; // open the panel on the cut there is
  sectionClose: () => void; // ✓: close the panel, keep the cut
  sectionPlane: (name: DefaultPlane) => void; // the default plane, when no face is picked
  sectionActive: (row: number) => void; // the row the 3D handle is on
  // N: look straight at a direction (model frame, the side to look from), or at the newest cut,
  // else the newest picked flat face.
  viewNormal: (normal?: V3) => void;
  onSection: (cb: (v: SectionView | null) => void) => () => void;
};

export type SectionLayer = {
  tools: SectionTools;
  picked: (parts: string[], newest: Pick | null) => void; // the measure picks changed
  // A click on the model (picking.ts): taken while the panel is open, so it makes no measure pick.
  tap: (e: MouseEvent) => boolean;
  dispose: () => void;
};

const CLICK_PX = 4;
const vec = (v: V3) => new THREE.Vector3(v[0], v[1], v[2]);
const round1 = (n: number) => Math.round(n * 10) / 10;

export function createSection(stage: Stage, meshes: PartMesh[], topo: Topo, look: (dir: [number, number, number]) => void): SectionLayer {
  const { el, renderer, root, render } = stage;
  const canvas = renderer.domElement;
  const caps = createCaps(stage, meshes);
  const handle = createHandle(stage);
  let state: Section | null = null;
  let active = 0;
  let face: { point: V3; normal: V3 } | null = null;
  let roundAxis: V3 | null = null; // the newest pick when it is a round face: N looks along it
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

  const onFrame = () => placeBox();
  stage.beforeRender.push(onFrame);

  // From the model towards the viewer (model frame): the camera's back direction.
  const toViewer = () => {
    root.updateMatrixWorld();
    return stage.camera.getWorldDirection(new THREE.Vector3()).negate().transformDirection(root.matrixWorld.clone().invert());
  };

  const view = (): SectionView | null =>
    state && {
      ...state,
      active,
      ranges: state.planes.map((p) => offsetRange(p, modelBox())),
      caps: caps.stencil ? "stencil" : "flat",
    };
  const emit = () => {
    const v = view();
    listeners.forEach((cb) => cb(v));
  };

  // The handle's frame on a plane (model frame): its point and its turned in-plane axes.
  const frameOf = (c: Cut): Frame => {
    const { point, normal } = planeAt(c);
    const [u0, v0] = inPlaneAxes(vec(c.normal).normalize());
    const q = new THREE.Quaternion().setFromAxisAngle(v0, (c.tilt[1] * Math.PI) / 180).multiply(new THREE.Quaternion().setFromAxisAngle(u0, (c.tilt[0] * Math.PI) / 180));
    return { point, n: normal, u: u0.applyQuaternion(q), v: v0.applyQuaternion(q) };
  };

  const apply = () => {
    if (!state || !state.planes.length) {
      state = null;
      renderer.clippingPlanes = [];
      caps.update([], root.matrixWorld);
      handle.set(null);
      showBox(false);
      render();
      emit();
      return;
    }
    root.updateMatrixWorld();
    active = Math.max(0, Math.min(active, state.planes.length - 1));
    renderer.clippingPlanes = state.planes.map((p) => clipPlane(p).applyMatrix4(root.matrixWorld));
    caps.update(state.planes, root.matrixWorld);
    // The handle and its number box only while the panel is open, like Onshape's.
    handle.set(state.open ? frameOf(state.planes[active]) : null);
    showBox(state.open);
    render();
    emit();
  };

  const section = (s: Section | null) => {
    // A saved view from before 2026-11-11 may hold a cylindrical cut, which is gone: dropped.
    const planes = s?.planes.filter((p) => (p as { kind?: string }).kind !== "cylinder").slice(0, MAX_PLANES) ?? [];
    state = s && planes.length ? { planes, open: s.open } : null;
    apply();
  };
  const setCuts = (planes: Cut[], row = active) => {
    active = row;
    section({ planes: planes.length ? planes : [defaultPlane("front", modelBox())], open: state?.open ?? true });
  };
  const isDefault = (c: Cut) => c.from !== "face";
  const sectionFromFace = (point: V3, normal: V3) => {
    active = 0;
    section({ planes: [facePlane(point, normal)], open: true });
  };
  const sectionFromRound = (r: RoundFace) => {
    active = 0;
    section({ planes: [roundFacePlane(r.axisPoint, r.axis, r.point, toViewer())], open: true });
  };
  const sectionShow = (open: boolean) => {
    if (!open) return section(null);
    if (state) return section({ ...state, open: true });
    active = 0;
    section({ planes: [face ? facePlane(face.point, face.normal) : defaultPlane("front", modelBox())], open: true });
  };
  const sectionPlane = (name: DefaultPlane) => {
    active = 0;
    section({ planes: [defaultPlane(name, modelBox())], open: state?.open ?? true });
  };

  // The same face clicked again takes its cut off, like a second click on a selection in Onshape.
  const sameCut = (p: Cut, q: Cut) =>
    p.from === "face" && q.from === "face" && vec(p.normal).dot(vec(q.normal)) > 0.9999 && Math.abs(vec(q.origin).sub(vec(p.origin)).dot(vec(p.normal))) < 1e-6;
  const addCut = (c: Cut) => {
    if (!state) return;
    const cuts = state.planes.filter((p) => !isDefault(p));
    const same = cuts.findIndex((p) => sameCut(p, c));
    if (same >= 0) return setCuts(cuts.filter((_, k) => k !== same), Math.max(0, cuts.length - 2));
    if (cuts.length >= MAX_PLANES) return;
    setCuts([...cuts, c], cuts.length);
  };

  // The ray from the pointer and the nearest part surface along it that the section keeps (what
  // shows there), with its copy and the face (model frame).
  const caster = new THREE.Raycaster();
  const bothSides = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const castAt = (x: number, y: number) => {
    const rect = canvas.getBoundingClientRect();
    caster.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -(((y - rect.top) / rect.height) * 2 - 1)), stage.camera);
    caster.firstHitOnly = false;
    const shown = meshes.filter((m) => m.mesh.visible).map((m) => m.mesh);
    const toModel = root.matrixWorld.clone().invert();
    const rayModel = caster.ray.clone().applyMatrix4(toModel);
    // Both sides of every triangle: the parts' own materials draw front faces only, and a raycast
    // skips the faces its material doesn't draw, so the surfaces leaving a part would be missed.
    const own = shown.map((m) => m.material);
    shown.forEach((m) => (m.material = bothSides));
    let raw: THREE.Intersection[];
    try {
      raw = caster.intersectObjects(shown, false);
    } finally {
      shown.forEach((m, k) => (m.material = own[k]));
    }
    const hits = raw.flatMap((h) => {
      const m = meshes.findIndex((x) => x.mesh === h.object);
      if (m < 0 || h.instanceId === undefined || h.faceIndex == null) return [];
      const at = topo.placeOf(m, h.instanceId);
      const point = h.point.clone().applyMatrix4(toModel);
      // The triangle's own outward normal, from its winding: the raycast's face.normal is turned
      // towards the ray on double-sided materials, which would make every hit look like an entry.
      const g = meshes[m].mesh.geometry;
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      const idx = g.index!.array;
      const [a, b, c] = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, idx[h.faceIndex! * 3 + k]));
      const normal = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3()).applyMatrix3(new THREE.Matrix3().getNormalMatrix(at)).normalize();
      return [{ m, i: h.instanceId, tri: h.faceIndex, at, point, normal, t: point.clone().sub(rayModel.origin).dot(rayModel.direction) }];
    });
    hits.sort((a, b) => a.t - b.t);
    const kept = (p: THREE.Vector3) => !state || !state.planes.some((c) => removedBy(c, p));
    return { ray: rayModel, hits, front: hits.find((h) => kept(h.point)) ?? null };
  };

  // While the panel is open: a flat face adds a plane on it (at the face's middle), a round one a
  // plane through its axis facing the viewer; anything else (or empty space) does nothing, and makes no pick either.
  const tap = (e: MouseEvent) => {
    if (!state?.open) return false;
    const h = castAt(e.clientX, e.clientY).front;
    if (!h) return true;
    const t = topo.topoOf(h.m);
    const f = t.faces[t.triFace[h.tri]];
    if (f.kind === "plane" && f.normal) {
      const g = meshes[h.m].mesh.geometry;
      const idx = g.index!.array;
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      const mid = new THREE.Vector3();
      const q = new THREE.Vector3();
      for (const tri of f.tris) for (let k = 0; k < 3; k++) mid.add(q.fromBufferAttribute(pos, idx[tri * 3 + k]));
      mid.divideScalar(f.tris.length * 3).applyMatrix4(h.at);
      const n = vec(f.normal).applyMatrix3(new THREE.Matrix3().getNormalMatrix(h.at)).normalize();
      addCut(facePlane(mid.toArray() as V3, n.toArray() as V3));
    } else if (f.kind === "cylinder" && f.axis && f.point) {
      const axis = vec(f.axis).transformDirection(h.at);
      const p = vec(f.point).applyMatrix4(h.at);
      addCut(roundFacePlane(p.toArray() as V3, axis.toArray() as V3, h.point.toArray() as V3, toViewer()));
    }
    return true;
  };

  // The newest pick, when it is a flat face: its plane in the model frame (Shift+X and N use it).
  const picked = (_keys: string[], newest: Pick | null) => {
    face = null;
    roundAxis = null;
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
      } else if (f.kind === "cylinder" && f.axis) {
        // A round face: N looks along its axis, like Onshape.
        const at = topo.placeOf(newest.m, newest.i);
        roundAxis = new THREE.Vector3(...f.axis).applyMatrix3(new THREE.Matrix3().getNormalMatrix(at)).normalize().toArray() as V3;
      }
    }
  };

  const viewNormal = (normal?: V3) => {
    const c = state?.planes[active];
    const d = normal ? vec(normal) : c ? viewDirection(c) : face ? vec(face.normal) : roundAxis ? vec(roundAxis) : null;
    if (!d || !d.lengthSq()) return;
    root.updateMatrixWorld();
    const dir = d.normalize().transformDirection(root.matrixWorld);
    // An axis has two ends: look from the one nearer the camera, so the view doesn't flip over.
    if (!normal && !c && !face && dir.dot(stage.camera.getWorldDirection(new THREE.Vector3())) > 0) dir.negate();
    look(dir.toArray() as [number, number, number]);
  };

  // The number box by the handle: the depth (mm) or the angle of the arc being dragged, typed exactly (Enter or leaving the box sets it).
  const box = document.createElement("label");
  box.className = "absolute z-20 hidden items-center gap-1 rounded-md border border-accent/60 bg-surface/95 px-1.5 py-0.5 text-xs text-muted shadow-sm backdrop-blur tabular-nums";
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.className = "h-6 w-16 rounded border border-line bg-surface px-1 text-right text-xs text-fg tabular-nums pointer-coarse:h-8";
  const unit = document.createElement("span");
  box.append(input, unit);
  el.appendChild(box);
  let boxMode: HandlePart = "move";
  let boxShown = false;
  const boxValue = () => {
    const c = state?.planes[active];
    if (!c) return "";
    return String(boxMode === "move" ? c.offset : c.tilt[boxMode === "u" ? 0 : 1]);
  };
  const fillBox = () => {
    input.setAttribute("aria-label", boxMode !== "move" ? "Section tilt (degrees)" : "Section depth (mm)");
    unit.textContent = boxMode !== "move" ? "°" : "mm";
    if (document.activeElement !== input) input.value = boxValue();
  };
  const showBox = (on: boolean) => {
    boxShown = on;
    box.classList.toggle("hidden", !on);
    box.classList.toggle("flex", on);
    if (on) fillBox();
  };
  const placeBox = () => {
    if (!boxShown) return;
    const a = handle.anchor();
    if (!a) return box.classList.add("invisible");
    box.classList.remove("invisible");
    const w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = `${Math.max(4, Math.min(el.clientWidth - w - 4, a[0] + 12))}px`;
    box.style.top = `${Math.max(4, Math.min(el.clientHeight - h - 4, a[1] - h / 2))}px`;
  };
  const typed = () => {
    const n = Number(input.value.replace(",", "."));
    const c = state?.planes[active];
    if (!state || !c || !input.value.trim() || !Number.isFinite(n)) return fillBox();
    let next: Cut;
    if (boxMode === "move") next = { ...c, offset: n };
    else {
      const tilt: [number, number] = [...c.tilt];
      tilt[boxMode === "u" ? 0 : 1] = wrapDeg(n);
      next = { ...c, tilt };
    }
    setCuts(state.planes.map((p, k) => (k === active ? next : p)));
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // the viewer's keys (Y, N, F…) stay out of the box
    if (e.key === "Enter") {
      typed();
      input.blur();
    } else if (e.key === "Escape") {
      input.value = boxValue();
      input.blur();
    }
  });
  input.addEventListener("blur", typed);

  // Dragging the handle: the arrow moves the plane along its normal (mm), an arc tilts it. A click on the arrow without moving flips the cut, like Onshape's.
  let drag: { part: HandlePart; id: number; x: number; y: number; moved: boolean; start: Cut; t0: number; centre: THREE.Vector3; axis: THREE.Vector3; ref: THREE.Vector3; n: THREE.Vector3 } | null = null;
  const onDown = (e: PointerEvent) => {
    if (!state?.open || e.button !== 0 || e.target !== canvas) return;
    const part = handle.hit(e.clientX, e.clientY, e.pointerType !== "mouse");
    if (!part) return;
    const c = state.planes[active];
    const f = frameOf(c);
    const ray = handle.ray(e.clientX, e.clientY);
    const [axis, ref] = part === "u" ? [f.u, f.v] : [f.v, f.n];
    const t0 = part === "move" ? alongLine(ray.origin, ray.direction, f.point, f.n) : ringAngle(ray.origin, ray.direction, f.point, axis, ref);
    if (t0 === null) return;
    // Ours alone: no rotate, no pick.
    e.stopPropagation();
    e.preventDefault();
    drag = { part, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, start: structuredClone(c), t0, centre: f.point, axis, ref, n: f.n };
    if (boxMode !== part) {
      boxMode = part;
      fillBox();
    }
    handle.lit(part);
    render();
  };
  let hovered: HandlePart | null = null;
  const onMove = (e: PointerEvent) => {
    if (!drag) {
      // Mouse hover: light the part under the pointer.
      if (state?.open && e.pointerType === "mouse" && !e.buttons && e.target === canvas) {
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
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= CLICK_PX) return;
    drag.moved = true;
    const ray = handle.ray(e.clientX, e.clientY);
    const p = structuredClone(drag.start);
    if (drag.part === "move") {
      const t = alongLine(ray.origin, ray.direction, drag.centre, drag.n);
      if (t === null) return;
      p.offset = round1(drag.start.offset + (t - drag.t0) * 1000);
    } else {
      const a = ringAngle(ray.origin, ray.direction, drag.centre, drag.axis, drag.ref);
      if (a === null) return;
      const k = drag.part === "u" ? 0 : 1;
      p.tilt[k] = round1(wrapDeg(drag.start.tilt[k] + ((a - drag.t0) * 180) / Math.PI));
    }
    state = { ...state, planes: state.planes.map((c, k) => (k === active ? p : c)) };
    apply();
  };
  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    e.stopPropagation();
    const flip = drag.part === "move" && !drag.moved;
    drag = null;
    hovered = null;
    handle.lit(null);
    if (flip && state) setCuts(state.planes.map((c, k) => (k === active ? { ...c, flip: !c.flip } : c)));
    else render();
  };

  // A double-click on a cut face (a cap) while the panel is closed opens it again. A cap shows
  // where the cut surface is nearer than any kept part surface and lies inside a part there.
  const capAt = (x: number, y: number): number | null => {
    if (!state) return null;
    const { ray, hits, front } = castAt(x, y);
    let best: { k: number; t: number } | null = null;
    for (let k = 0; k < state.planes.length; k++) {
      const c = state.planes[k];
      const { point, normal } = planeAt(c);
      const d = ray.direction.dot(normal);
      const t = Math.abs(d) > 1e-9 ? point.clone().sub(ray.origin).dot(normal) / d : null;
      if (t === null || t <= 0 || (front && t > front.t) || (best && t > best.t)) continue;
      const q = ray.at(t, new THREE.Vector3());
      if (state.planes.some((o, j) => j !== k && removedBy(o, q))) continue;
      // Inside a part copy there: behind the point, that copy's surfaces leave more than enter
      // (counted per copy, so a part touching the next face to face doesn't confuse it).
      const tt = t;
      const count = new Map<string, number>();
      for (const h of hits) if (h.t > tt) count.set(`${h.m}:${h.i}`, (count.get(`${h.m}:${h.i}`) ?? 0) + (h.normal.dot(ray.direction) > 0 ? 1 : -1));
      if ([...count.values()].some((n) => n > 0)) best = { k, t };
    }
    return best?.k ?? null;
  };
  const onDouble = (e: MouseEvent) => {
    if (!state || state.open || e.button !== 0 || e.target !== canvas) return;
    const k = capAt(e.clientX, e.clientY);
    if (k === null) return;
    e.stopPropagation();
    active = k;
    section({ ...state, open: true });
  };

  // Shift+X: section view on / off; N: view normal to. For this viewer while the mouse is over it
  // or it was the last thing touched, not while typing, and only where a page shows the panel.
  let over = false;
  let focused = false;
  const onEnter = () => (over = true);
  const onLeave = () => (over = false);
  const onAnyDown = (e: PointerEvent) => (focused = el.contains(e.target as Node));
  const onKey = (e: KeyboardEvent) => {
    if ((!over && !focused) || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]")) return;
    if ([...document.querySelectorAll("dialog[open]")].some((d) => !d.contains(el))) return;
    if (e.code === "KeyX" && e.shiftKey && listeners.size) sectionShow(!state);
    else if (e.code === "KeyN" && !e.shiftKey) viewNormal();
    else return;
    e.preventDefault();
  };

  // On the canvas's parent, in the capture phase: before the camera controls and picking see it.
  el.addEventListener("pointerdown", onDown, true);
  el.addEventListener("dblclick", onDouble, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
  el.addEventListener("pointerenter", onEnter);
  el.addEventListener("pointerleave", onLeave);
  window.addEventListener("pointerdown", onAnyDown, true);
  window.addEventListener("keydown", onKey);

  return {
    tools: {
      section,
      sectionNow: () => state,
      sectionFromFace,
      sectionFromRound,
      sectionShow,
      sectionEdit: () => state && section({ ...state, open: true }),
      sectionClose: () => state && section({ ...state, open: false }),
      sectionPlane,
      sectionActive: (row) => {
        active = row;
        apply();
      },
      viewNormal,
      onSection: (cb) => {
        listeners.add(cb);
        cb(view());
        return () => {
          listeners.delete(cb);
        };
      },
    },
    picked,
    tap,
    dispose: () => {
      el.removeEventListener("pointerdown", onDown, true);
      el.removeEventListener("dblclick", onDouble, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("pointerdown", onAnyDown, true);
      window.removeEventListener("keydown", onKey);
      const i = stage.beforeRender.indexOf(onFrame);
      if (i >= 0) stage.beforeRender.splice(i, 1);
      renderer.clippingPlanes = [];
      box.remove();
      bothSides.dispose();
      caps.dispose();
      handle.dispose();
      listeners.clear();
    },
  };
}
