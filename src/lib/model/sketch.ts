// A Basepart's Geometry sketches (Harel, 2026-11-12): the sketches the team picks in the Onshape
// panel, drawn in the 3D views where Onshape draws them, shown and hidden with Shift+H, isolated
// like parts, and picked for measuring (lines, arcs and their points). Onshape gives each sketch
// entity as points along it (tessellatedentities), in the Part Studio's frame, metres. Kept in
// R2 as one small JSON file per Part Studio revision and choice of sketches.
import { classifyEdge, type Edge, type Topology, type V3 } from "./topology";

// One entity: its points one after another (x, y, z…); `closed` when it comes back to its start
// (a circle), `c` for a construction entity (drawn fainter, as Onshape does).
export type SketchEntity = { p: number[]; closed?: boolean; c?: boolean };
export type Sketch = { id: string; name: string; entities: SketchEntity[]; points: number[] };
export type SketchFile = { v: 1; sketches: Sketch[] };

// Onshape's answers, as far as they're used here.
type TessAnswer = { sketchEntities?: { entityId?: string; tessellationPoints?: number[][] }[] };
type InfoAnswer = { sketches?: { sketchId?: string; featureId?: string; transformMatrix?: number[]; geomEntities?: { id?: string; entityId?: string; isConstruction?: boolean }[] }[] };

const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] ?? 0) - (b[2] ?? 0)) < 1e-9;

// A sketch from its tessellated entities. Points that come in the sketch plane's 2D are moved into
// the Part Studio by the sketch's transform from its info (row-major 4×4, as Onshape's are).
export function sketchFromAnswers(id: string, name: string, tess: TessAnswer, info?: InfoAnswer): Sketch {
  const own = info?.sketches?.find((s) => (s.sketchId ?? s.featureId) === id) ?? info?.sketches?.[0];
  const construction = new Set((own?.geomEntities ?? []).flatMap((e) => (e.isConstruction ? [e.id ?? e.entityId ?? ""] : [])));
  const m = own?.transformMatrix?.length === 16 ? own.transformMatrix : null;
  const to3 = (q: number[]): V3 => {
    if (q.length >= 3) return [q[0], q[1], q[2]];
    const [x, y] = q;
    return m ? [m[0] * x + m[1] * y + m[3], m[4] * x + m[5] * y + m[7], m[8] * x + m[9] * y + m[11]] : [x, y, 0];
  };
  const entities: SketchEntity[] = [];
  const points: number[] = [];
  for (const e of tess.sketchEntities ?? []) {
    const pts = (e.tessellationPoints ?? []).filter((q) => Array.isArray(q) && q.length >= 2).map(to3);
    if (!pts.length) continue;
    if (pts.length === 1) {
      points.push(...pts[0]);
      continue;
    }
    const closed = pts.length > 2 && near(pts[0], pts[pts.length - 1]);
    if (closed) pts.pop();
    entities.push({ p: pts.flat().map((n) => +n.toFixed(7)), ...(closed ? { closed } : {}), ...(e.entityId && construction.has(e.entityId) ? { c: true } : {}) });
  }
  return { id, name, entities, points: points.map((n) => +n.toFixed(7)) };
}

const v3 = (p: number[], i: number): V3 => [p[i], p[i + 1], p[i + 2]];
const key = (q: V3) => q.map((n) => Math.round(n * 1e6)).join(",");

// What measuring needs, in the topology's shape (no faces): each entity an edge, and the corners
// a pointer can pick: sketch points and the ends of open entities, each spot once.
export function sketchTopology(s: Sketch): Topology {
  const edges: Edge[] = s.entities.map((e) => {
    const points: V3[] = [];
    for (let i = 0; i + 2 < e.p.length; i += 3) points.push(v3(e.p, i));
    const edge: Edge = { points, closed: !!e.closed, faces: [-1, -1], length: 0, kind: "other" };
    classifyEdge(edge);
    return edge;
  });
  const corners = new Map<string, V3>();
  for (let i = 0; i + 2 < s.points.length; i += 3) corners.set(key(v3(s.points, i)), v3(s.points, i));
  for (const e of edges) if (!e.closed) for (const q of [e.points[0], e.points[e.points.length - 1]]) corners.set(key(q), q);
  return { triFace: new Int32Array(0), faces: [], edges, corners: [...corners.values()] };
}

// A sketch's model key, so isolating, hiding and saved views treat it like a part.
export const sketchKey = (owner: string, id: string) => `sketch:${owner}:${id}`;
export const isSketchKey = (k: string) => k.startsWith("sketch:");
