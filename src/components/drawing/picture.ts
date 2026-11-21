// An added angled view's picture, drawn like Onshape's drawing views (Harel, 2026-11-21): white
// faces, black edges, hidden edges removed, a true orthographic projection, at print resolution.
// The part's mesh only hides what's behind; the edges are the exact ones of the kept geometry
// (bodyPack.ts), plus the outline of curved faces (where the mesh turns away from the camera).

import * as THREE from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { cross, dot, type Body, unit, type V3 } from "@/lib/drawing/brep";
import type { Mesh } from "@/lib/model/mesh";

const PX_PER_MM = 300 / 25.4; // 300 dpi, as the PDF
const LINE_MM = 0.35; // a visible line's width on paper
const MAX_PX = 4096;
const PAD = 1; // view mm around the part, so its outline isn't cut in half

export type Picture = { blob: Blob; w: number; h: number }; // w / h: the picture's size in view mm

// `dir`: from the part towards the camera, `right`: the screen's right, both in Part Studio axes.
// `scale`: sheet mm per view mm where it's placed, for its resolution.
export async function drawPicture(mesh: Mesh, body: Body, dir: V3, right: V3, scale: number): Promise<Picture> {
  const back = unit(dir);
  const up = unit(cross(back, right));
  const rt = unit(cross(up, back));
  const pts = body.edges.flat();
  const xs = pts.map((p) => dot(p, rt));
  const ys = pts.map((p) => dot(p, up));
  const ds = pts.map((p) => dot(p, back));
  const [x0, x1, y0, y1] = [Math.min(...xs) - PAD, Math.max(...xs) + PAD, Math.min(...ys) - PAD, Math.max(...ys) + PAD];
  const [d0, d1] = [Math.min(...ds), Math.max(...ds)];
  const [w, h] = [x1 - x0, y1 - y0];
  const k = Math.min(PX_PER_MM * Math.max(scale, 0.25) * 1.5, MAX_PX / Math.max(w, h));
  const [W, H] = [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];

  const scene = new THREE.Scene();
  // Faces: white, pushed back a little so the edges lying on them win the depth test.
  const geo = new THREE.BufferGeometry();
  const P = new Float32Array(mesh.positions.length);
  for (let i = 0; i < P.length; i++) P[i] = mesh.positions[i] * 1000; // m → mm, as the geometry
  geo.setAttribute("position", new THREE.BufferAttribute(P, 3));
  geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  const faces = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  scene.add(faces);

  const segs: number[] = [];
  for (const e of body.edges) for (let i = 1; i < e.length; i++) segs.push(...e[i - 1], ...e[i]);
  segs.push(...outline(geo, back));
  const lineGeo = new LineSegmentsGeometry().setPositions(segs);
  const material = new LineMaterial({ color: 0x000000, linewidth: LINE_MM * k, worldUnits: false });
  material.resolution.set(W, H);
  scene.add(new LineSegments2(lineGeo, material));

  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 1, d1 - d0 + 20);
  const at = (a: number, b: number, c: number) => new THREE.Vector3(rt[0] * a + up[0] * b + back[0] * c, rt[1] * a + up[1] * b + back[1] * c, rt[2] * a + up[2] * b + back[2] * c);
  camera.position.copy(at(cx, cy, d1 + 10));
  camera.up.set(...up);
  camera.lookAt(at(cx, cy, d0));

  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.setClearColor(0xffffff, 1);
    renderer.render(scene, camera);
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't draw the view."))), "image/png"));
    return { blob, w, h };
  } finally {
    geo.dispose();
    lineGeo.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

// The mesh's outline seen along `back`: edges between a triangle facing the camera and one
// facing away (a round tube's sides, a hole's walls seen at an angle).
function outline(geo: THREE.BufferGeometry, back: V3): number[] {
  const m = mergeVertices(geo.clone().deleteAttribute("normal"), 1e-4);
  const pos = m.getAttribute("position") as THREE.BufferAttribute;
  const idx = m.getIndex()!;
  const facing: boolean[] = [];
  const edges = new Map<string, number[]>();
  const v = (i: number): V3 => [pos.getX(i), pos.getY(i), pos.getZ(i)];
  for (let t = 0; t < idx.count / 3; t++) {
    const [a, b, c] = [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)];
    const [pa, pb, pc] = [v(a), v(b), v(c)];
    const n = cross([pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]]);
    facing.push(dot(n, back) > 0);
    for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      const list = edges.get(key);
      if (list) list.push(t);
      else edges.set(key, [t]);
    }
  }
  const out: number[] = [];
  for (const [key, tris] of edges) {
    if (tris.length !== 2 || facing[tris[0]] === facing[tris[1]]) continue;
    const [i, j] = key.split(",").map(Number);
    out.push(...v(i), ...v(j));
  }
  m.dispose();
  return out;
}
