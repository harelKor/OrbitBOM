// The robot's 3D model, step 2: a Part Studio's meshes in a small binary file, read by the
// browser viewer. One file per Part Studio revision, kept in R2 (gzipped).
//
// Layout (little-endian, 4-byte aligned): "OBM1", body count, then per body:
// id length, id bytes (padded to 4), vertex count, index count, float32 xyz, uint32 indices.

export type Mesh = { partId: string; positions: Float32Array; indices: Uint32Array };

const MAGIC = 0x314d424f; // "OBM1"

type Vec = number[] | { x: number; y: number; z: number };
type Facet = { vertices?: Vec[]; indices?: number[] };
type Body = { id?: string; facetPoints?: Vec[]; faces?: { facets?: Facet[] }[] };
export type Tessellation = Body[] | { bodies?: Body[]; facetPoints?: Vec[] };

const xyz = (v: Vec): [number, number, number] => (Array.isArray(v) ? [v[0], v[1], v[2]] : [v.x, v.y, v.z]);

// Onshape's tessellatedfaces answer to meshes. Vertices are shared within a face only, so the
// viewer's smooth normals keep a part's edges crisp.
export function meshesFromTessellation(t: Tessellation): Mesh[] {
  const bodies = Array.isArray(t) ? t : (t.bodies ?? []);
  const shared = Array.isArray(t) ? undefined : t.facetPoints;
  const out: Mesh[] = [];
  for (const body of bodies) {
    if (!body.id) continue;
    const points = body.facetPoints ?? shared;
    const pos: number[] = [];
    const idx: number[] = [];
    for (const face of body.faces ?? []) {
      const seen = new Map<string, number>();
      for (const facet of face.facets ?? []) {
        const verts = facet.vertices?.length
          ? facet.vertices
          : points && facet.indices
            ? facet.indices.map((i) => points[i]).filter(Boolean)
            : [];
        if (verts.length < 3) continue;
        for (const v of verts.slice(0, 3)) {
          const p = xyz(v);
          const k = p.join(",");
          let i = seen.get(k);
          if (i === undefined) {
            i = pos.length / 3;
            seen.set(k, i);
            pos.push(...p);
          }
          idx.push(i);
        }
      }
    }
    if (idx.length) out.push({ partId: body.id, positions: new Float32Array(pos), indices: new Uint32Array(idx) });
  }
  return out;
}

const pad4 = (n: number) => (n + 3) & ~3;

export function encodeMeshes(meshes: Mesh[]): Uint8Array {
  const enc = new TextEncoder();
  const ids = meshes.map((m) => enc.encode(m.partId));
  let size = 8;
  meshes.forEach((m, i) => (size += 4 + pad4(ids[i].length) + 8 + m.positions.byteLength + m.indices.byteLength));
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, meshes.length, true);
  let o = 8;
  meshes.forEach((m, i) => {
    view.setUint32(o, ids[i].length, true);
    bytes.set(ids[i], o + 4);
    o += 4 + pad4(ids[i].length);
    view.setUint32(o, m.positions.length / 3, true);
    view.setUint32(o + 4, m.indices.length, true);
    o += 8;
    new Float32Array(buf, o, m.positions.length).set(m.positions);
    o += m.positions.byteLength;
    new Uint32Array(buf, o, m.indices.length).set(m.indices);
    o += m.indices.byteLength;
  });
  return bytes;
}

export function decodeMeshes(buf: ArrayBuffer): Mesh[] {
  const view = new DataView(buf);
  if (buf.byteLength < 8 || view.getUint32(0, true) !== MAGIC) throw new Error("Not a robot model file.");
  const dec = new TextDecoder();
  const count = view.getUint32(4, true);
  const out: Mesh[] = [];
  let o = 8;
  for (let i = 0; i < count; i++) {
    const len = view.getUint32(o, true);
    const partId = dec.decode(new Uint8Array(buf, o + 4, len));
    o += 4 + pad4(len);
    const nv = view.getUint32(o, true);
    const ni = view.getUint32(o + 4, true);
    o += 8;
    const positions = new Float32Array(buf, o, nv * 3);
    o += nv * 12;
    const indices = new Uint32Array(buf, o, ni);
    o += ni * 4;
    out.push({ partId, positions, indices });
  }
  return out;
}
