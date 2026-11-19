// Comment tags in the 3D view (S6, plan/cad-3d-viewer.md; reshaped by Harel 2026-11-18,
// plan/cad-design-review.md): a speech bubble with its author's picture, its tail on the comment's
// point, the same size on screen at any zoom, drawn as buttons over the canvas and moved before
// each frame. A tap hands its id to the page, which opens the comment as a popup: `popupHost` is a
// box the page draws into, kept next to the tag with its tail on the point. The view never moves.
// Points are in assembly mm (Onshape's model frame), so they don't depend on how the scene is set up.
import * as THREE from "three";
import type { Pick } from "./picking";
import type { Topo } from "./picking";
import type { Stage } from "./stage";
import type { PartMesh } from "./types";

// `color`: its comment's status colour (Harel, 2026-11-13); `avatar` / `initials`: its author.
export type Pin = { id: string; at: [number, number, number]; color: string; avatar?: string | null; initials: string; title: string };

export type PinTools = {
  // `onHover`: the tag under the mouse (null when it leaves), for the page to light its comment.
  pins: (list: Pin[], onTap: ((id: string) => void) | null, onHover?: (id: string | null) => void) => void;
  pinHot: (id: string | null) => void; // the comment under the mouse or open: its tag drawn larger
  popupHost: () => HTMLElement; // the page renders the open comment's popup in here
  popupFor: (id: string | null) => void; // which tag the popup belongs to (null: hidden)
  pickPoint: () => [number, number, number] | null; // the newest pick's point, in assembly mm
};

// The bubble; bigger on touch screens, to be hit with a finger (Harel, 2026-11-19).
const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
const W = coarse ? 38 : 30;
const H = coarse ? 36 : 28;
const TAIL = 8; // its tail, below its left side; the tip is the point

export function createPins(stage: Stage, meshes: PartMesh[], topo: Topo, newest: () => Pick | null): { tools: PinTools; dispose: () => void } {
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5";
  stage.el.appendChild(layer);
  const popup = document.createElement("div");
  popup.style.cssText = "position:absolute;left:0;top:0;pointer-events:auto;display:none;z-index:2";
  for (const ev of ["pointerdown", "mousedown", "touchstart", "contextmenu", "wheel"]) popup.addEventListener(ev, (e) => e.stopPropagation());
  layer.appendChild(popup);
  let list: Pin[] = [];
  let tap: ((id: string) => void) | null = null;
  let hoverCb: ((id: string | null) => void) | undefined;
  let hot: string | null = null;
  let open: string | null = null;
  const tags = new Map<string, HTMLButtonElement>();
  const p = new THREE.Vector3();

  const screenOf = (at: [number, number, number], w: number, h: number) => {
    p.set(at[0] / 1000, at[1] / 1000, at[2] / 1000).applyMatrix4(stage.root.matrixWorld).project(stage.camera);
    const off = p.z > 1 || p.z < -1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2;
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, off };
  };

  const place = () => {
    if (!list.length) return;
    const w = stage.renderer.domElement.clientWidth; // the canvas: what the camera projects onto
    const h = stage.renderer.domElement.clientHeight;
    stage.root.updateMatrixWorld();
    stage.camera.updateMatrixWorld();
    // Tags whose bubbles would sit on top of each other are nudged up, their tails still on their points.
    const taken: { x: number; y: number }[] = [];
    for (const pin of list) {
      const el = tags.get(pin.id)!;
      const s = screenOf(pin.at, w, h);
      el.style.display = s.off ? "none" : "";
      if (s.off) continue;
      let lift = 0;
      while (lift < 4 * H && taken.some((q) => Math.abs(q.x - s.x) < W - 4 && Math.abs(q.y - (s.y - lift)) < H - 4)) lift += H - 6;
      taken.push({ x: s.x, y: s.y - lift });
      el.style.transform = `translate(${s.x - 2}px, ${s.y - H - TAIL - lift}px)${pin.id === hot || pin.id === open ? " scale(1.18)" : ""}`;
      el.style.zIndex = pin.id === hot || pin.id === open ? "1" : "";
      const stem = el.lastElementChild as HTMLElement;
      stem.style.height = `${TAIL + lift}px`;
    }
    const at = open && list.find((x) => x.id === open);
    if (!at) {
      popup.style.display = "none";
      return;
    }
    const s = screenOf(at.at, w, h);
    popup.style.display = s.off ? "none" : "";
    if (s.off) return;
    // Above and right of the point, its tail at the bottom left; below it when there's no room above.
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    const below = s.y - ph - 14 < 4;
    const x = Math.min(Math.max(4, s.x - 14), Math.max(4, w - pw - 4));
    const y = below ? s.y + 14 : s.y - ph - 14;
    popup.style.transform = `translate(${x}px, ${y}px)`;
    popup.dataset.below = below ? "1" : "";
    popup.style.setProperty("--tail-x", `${Math.min(Math.max(10, s.x - x - 7), pw - 24)}px`);
  };
  stage.beforeRender.push(place);

  const pins = (next: Pin[], onTap: ((id: string) => void) | null, onHover?: (id: string | null) => void) => {
    list = next;
    tap = onTap;
    hoverCb = onHover;
    for (const [id, el] of tags)
      if (!next.some((x) => x.id === id)) {
        el.remove();
        tags.delete(id);
      }
    for (const pin of next) {
      let el = tags.get(pin.id);
      if (!el) {
        el = document.createElement("button");
        el.type = "button";
        el.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;padding:0;border:none;background:none;pointer-events:auto;cursor:pointer;transform-origin:2px ${H + TAIL}px;transition:transform 80ms`;
        // The bubble (its picture inside) and its tail, a thin stem down to the point.
        el.innerHTML = `<span data-b style="position:absolute;inset:0;border-radius:10px 10px 10px 3px;border:2px solid;overflow:hidden;display:flex;align-items:center;justify-content:center;font:700 10px/1 system-ui,sans-serif;color:white;box-shadow:0 1px 4px rgb(0 0 0/.4)"></span><span style="position:absolute;left:0;top:${H - 2}px;width:2px;border-radius:1px"></span>`;
        // Not a click on the model: no pick, no rotate.
        for (const ev of ["pointerdown", "mousedown", "touchstart", "contextmenu"]) el.addEventListener(ev, (e) => e.stopPropagation());
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          tap?.(pin.id);
        });
        el.addEventListener("mouseenter", () => hoverCb?.(pin.id));
        el.addEventListener("mouseleave", () => hoverCb?.(null));
        layer.insertBefore(el, popup);
        tags.set(pin.id, el);
      }
      const b = el.firstElementChild as HTMLElement;
      const stem = el.lastElementChild as HTMLElement;
      b.style.borderColor = pin.color;
      b.style.background = pin.avatar ? "#1e2433" : pin.color;
      stem.style.background = pin.color;
      if (pin.avatar) {
        let img = b.querySelector("img");
        if (!img) {
          b.textContent = "";
          img = document.createElement("img");
          img.referrerPolicy = "no-referrer";
          img.style.cssText = "width:100%;height:100%;object-fit:cover";
          img.alt = "";
          b.appendChild(img);
        }
        if (img.src !== pin.avatar) img.src = pin.avatar;
      } else b.textContent = pin.initials;
      el.title = pin.title;
      el.setAttribute("aria-label", pin.title);
    }
    stage.render();
  };

  // A face: the middle of its triangles; an edge: its middle point; a corner: itself.
  const pickPoint = (): [number, number, number] | null => {
    const pk = newest();
    if (!pk || !meshes[pk.m]) return null;
    const t = topo.topoOf(pk.m);
    const q = new THREE.Vector3();
    if (pk.kind === "face") {
      const f = t.faces[pk.n];
      const g = meshes[pk.m].mesh.geometry;
      const idx = g.index!.array;
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      const r = new THREE.Vector3();
      for (const tri of f.tris) for (let k = 0; k < 3; k++) q.add(r.fromBufferAttribute(pos, idx[tri * 3 + k]));
      q.divideScalar(Math.max(1, f.tris.length * 3));
    } else if (pk.kind === "edge") {
      const pts = t.edges[pk.n].points;
      q.set(...pts[Math.floor(pts.length / 2)]);
    } else q.set(...t.corners[pk.n]);
    q.applyMatrix4(topo.placeOf(pk.m, pk.i)); // the copy's placement: model frame, metres
    return [Math.round(q.x * 1e5) / 100, Math.round(q.y * 1e5) / 100, Math.round(q.z * 1e5) / 100];
  };

  return {
    tools: {
      pins,
      pinHot: (id) => {
        hot = id;
        stage.render();
      },
      popupHost: () => popup,
      popupFor: (id) => {
        open = id;
        stage.render();
        // The popup's size is known once the page has drawn into it.
        requestAnimationFrame(() => stage.render());
      },
      pickPoint,
    },
    dispose: () => {
      const i = stage.beforeRender.indexOf(place);
      if (i >= 0) stage.beforeRender.splice(i, 1);
      layer.remove();
    },
  };
}
