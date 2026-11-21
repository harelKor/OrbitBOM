// A part's read geometry (brep.ts Body) as compact JSON, kept with its drawing (R2, bodyStore.ts)
// so views added in the drawing editor are made in the browser with no new Onshape calls.
// Millimetres rounded to 0.001; each edge a flat x, y, z list.

import type { Body, Face, V3 } from "./brep";

export type PackedBody = { v: 1; id: string; name: string; faces: Face[]; edges: number[][] };

const r = (n: number) => Math.round(n * 1000) / 1000;
const r3 = (p: V3): V3 => [r(p[0]), r(p[1]), r(p[2])];

export function packBody(b: Body): PackedBody {
  return {
    v: 1,
    id: b.id,
    name: b.name,
    faces: b.faces.map((f) => ({ ...f, area: r(f.area), center: r3(f.center), ...(f.radius != null ? { radius: r(f.radius) } : {}) })),
    edges: b.edges.map((e) => e.flatMap(r3)),
  };
}

export function unpackBody(p: PackedBody): Body {
  return {
    id: p.id,
    name: p.name,
    faces: p.faces,
    edges: p.edges.map((e) => {
      const pts: V3[] = [];
      for (let i = 0; i + 2 < e.length; i += 3) pts.push([e[i], e[i + 1], e[i + 2]]);
      return pts;
    }),
  };
}
