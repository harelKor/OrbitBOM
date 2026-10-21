// A part's exact geometry from Onshape (plan/auto-drawings.md): the `bodydetails` answer for its
// faces and the `tessellatededges` answer for drawing its edges. Read here into millimetres.

export type V3 = [number, number, number];
type Vec = { x: number; y: number; z: number };

type RawFace = {
  id: string;
  area?: number;
  orientation?: boolean;
  box?: { minCorner: Vec; maxCorner: Vec };
  surface?: { type?: string; normal?: Vec; axis?: Vec; radius?: number };
  loops?: { isOuter?: boolean; coedges?: unknown[] }[];
};
type RawBody = { id: string; properties?: { name?: string; material?: { displayName?: string } | null }; faces?: RawFace[] };
export type BodyDetails = { bodies?: RawBody[] };
export type TessellatedEdges = { bodies?: { id: string; edges?: { id: string; vertices?: Vec[] }[] }[] };

export type Face = {
  id: string;
  type: string; // PLANE, CYLINDER, ...
  area: number; // mm²
  concave: boolean; // the face's normal points against its surface's: holes, inner walls, inner corners
  dir?: V3; // plane normal or cylinder axis
  radius?: number; // mm
  loops: number;
  center: V3; // centre of the face's box, mm. A cylinder's origin can lie anywhere on its axis.
};
export type Body = { id: string; name: string; faces: Face[]; edges: V3[][] }; // edges as polylines, mm

const M = 1000;
const v3 = (v: Vec | undefined, s = 1): V3 => (v ? [v.x * s, v.y * s, v.z * s] : [0, 0, 0]);

// Onshape sends an edge's points as segment pairs (p0 p1 p1 p2 ...); this keeps each point once.
function polyline(points: Vec[]): V3[] {
  const out: V3[] = [];
  for (const p of points) {
    const q = v3(p, M);
    const last = out[out.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1], q[2] - last[2]) > 1e-6) out.push(q);
  }
  return out;
}

export function readBodies(details: BodyDetails, edges: TessellatedEdges): Body[] {
  return (details.bodies ?? []).map((b) => {
    const tess = edges.bodies?.find((e) => e.id === b.id);
    return {
      id: b.id,
      name: b.properties?.name ?? "",
      faces: (b.faces ?? []).map((f) => {
        const lo = v3(f.box?.minCorner, M);
        const hi = v3(f.box?.maxCorner, M);
        const s = f.surface ?? {};
        const dir = s.normal ?? s.axis;
        return {
          id: f.id,
          type: String(s.type ?? "").toUpperCase(),
          area: (f.area ?? 0) * M * M,
          concave: f.orientation === false,
          ...(dir ? { dir: v3(dir) } : {}),
          ...(s.radius != null ? { radius: s.radius * M } : {}),
          loops: f.loops?.length ?? 0,
          center: [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2],
        };
      }),
      edges: (tess?.edges ?? []).map((e) => polyline(e.vertices ?? [])).filter((p) => p.length > 1),
    };
  });
}

export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const parallel = (a: V3, b: V3) => Math.abs(dot(unit(a), unit(b))) > 0.999;
