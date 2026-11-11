// Comment pins (S6, plan/cad-3d-viewer.md): small numbered dots on the model, the same size on
// screen at any zoom (like the measure points), drawn as buttons over the canvas and moved before
// each frame. A tap on one hands its id to the page (which turns the view back to the comment's).
// Pins are in assembly mm (Onshape's model frame), so they don't depend on how the scene is set up.
import * as THREE from "three";
import type { Pick } from "./picking";
import type { Topo } from "./picking";
import type { Stage } from "./stage";
import type { PartMesh } from "./types";

export type Pin = { id: string; n: number; at: [number, number, number]; done?: boolean };

export type PinTools = {
  pins: (list: Pin[], onTap: ((id: string) => void) | null) => void;
  pinHot: (id: string | null) => void; // the comment the page has open: its pin drawn larger
  pickPoint: () => [number, number, number] | null; // the newest pick's point, in assembly mm
};

const SIZE = 18;

export function createPins(stage: Stage, meshes: PartMesh[], topo: Topo, newest: () => Pick | null): { tools: PinTools; dispose: () => void } {
  const layer = document.createElement("div");
  layer.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5";
  stage.el.appendChild(layer);
  let list: Pin[] = [];
  let tap: ((id: string) => void) | null = null;
  let hot: string | null = null;
  const dots = new Map<string, HTMLButtonElement>();
  const p = new THREE.Vector3();

  const place = () => {
    if (!list.length) return;
    const w = stage.renderer.domElement.clientWidth; // the canvas: what the camera projects onto
    const h = stage.renderer.domElement.clientHeight;
    stage.root.updateMatrixWorld();
    stage.camera.updateMatrixWorld();
    for (const pin of list) {
      const el = dots.get(pin.id)!;
      p.set(pin.at[0] / 1000, pin.at[1] / 1000, pin.at[2] / 1000).applyMatrix4(stage.root.matrixWorld).project(stage.camera);
      const off = p.z > 1 || p.z < -1 || Math.abs(p.x) > 1.2 || Math.abs(p.y) > 1.2;
      el.style.display = off ? "none" : "";
      el.style.transform = `translate(${((p.x + 1) / 2) * w - SIZE / 2}px, ${((1 - p.y) / 2) * h - SIZE / 2}px)${pin.id === hot ? " scale(1.35)" : ""}`;
    }
  };
  stage.beforeRender.push(place);

  const pins = (next: Pin[], onTap: ((id: string) => void) | null) => {
    list = next;
    tap = onTap;
    for (const [id, el] of dots)
      if (!next.some((x) => x.id === id)) {
        el.remove();
        dots.delete(id);
      }
    for (const pin of next) {
      let el = dots.get(pin.id);
      if (!el) {
        el = document.createElement("button");
        el.type = "button";
        el.style.cssText = `position:absolute;left:0;top:0;width:${SIZE}px;height:${SIZE}px;border-radius:9999px;font:600 10px/1 system-ui,sans-serif;display:flex;align-items:center;justify-content:center;pointer-events:auto;box-shadow:0 1px 3px rgb(0 0 0/.35);border:1.5px solid white;cursor:pointer;transition:transform 80ms`;
        // Not a click on the model: no pick, no rotate.
        for (const ev of ["pointerdown", "mousedown", "touchstart", "contextmenu"]) el.addEventListener(ev, (e) => e.stopPropagation());
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          tap?.(pin.id);
        });
        layer.appendChild(el);
        dots.set(pin.id, el);
      }
      el.textContent = String(pin.n);
      el.title = `Comment ${pin.n}`;
      el.setAttribute("aria-label", `Comment ${pin.n}`);
      el.style.background = pin.done ? "#0ea5e9" : "#f59e0b";
      el.style.color = "white";
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
      pickPoint,
    },
    dispose: () => {
      const i = stage.beforeRender.indexOf(place);
      if (i >= 0) stage.beforeRender.splice(i, 1);
      layer.remove();
    },
  };
}
