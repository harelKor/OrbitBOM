// The robot's 3D model, step 2: a Part Studio's meshes in a small binary file, read by the
// browser viewer. One file per Part Studio revision, kept in R2 (gzipped).
//
// Layout (little-endian, 4-byte aligned): "OBM2", body count, then per body:
// id length, id bytes (padded to 4), appearance flag (1 when set), rgba bytes, vertex count,
// index count, float32 xyz, uint32 indices. "OBM1" files have no appearance fields.

// Onshape's appearance of a part: colour 0-1 and opacity 0-1.
export type Appearance = { color: [number, number, number]; opacity: number };
export type Mesh = { partId: string; positions: Float32Array; indices: Uint32Array; appearance?: Appearance };

const MAGIC_V1 = 0x314d424f; // "OBM1"
const MAGIC = 0x324d424f; // "OBM2"

type Vec = number[] | { x: number; y: number; z: number };
type Facet = { vertices?: Vec[]; indices?: number[] };
type Look = { color?: unknown; opacity?: unknown };
type Body = { id?: string; facetPoints?: Vec[]; faces?: { facets?: Facet[]; appearance?: Look }[]; appearance?: Look };
export type Tessellation = Body[] | { bodies?: Body[]; facetPoints?: Vec[] };

// Onshape's colour, in whichever shape it comes: [r, g, b], { red, green, blue } or { r, g, b },
// "#rrggbb", or a packed 0xrrggbb number. Channels 0-255 or 0-1.
function rgb(c: unknown): [number, number, number] | undefined {
  let v: unknown[] | undefined;
  if (Array.isArray(c)) v = c;
  else if (typeof c === "string" && /^#?[0-9a-f]{6}$/i.test(c)) v = [0, 2, 4].map((i) => parseInt(c.replace("#", "").slice(i, i + 2), 16));
  else if (typeof c === "number" && Number.isFinite(c)) v = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  else if (c && typeof c === "object") {
    const o = c as Record<string, unknown>;
    v = [o.red ?? o.r, o.green ?? o.g, o.blue ?? o.b];
  }
  const n = v?.slice(0, 3).map(Number);
  if (!n || n.length < 3 || n.some((x) => !Number.isFinite(x))) return undefined;
  const scale = n.some((x) => x > 1) ? 255 : 1;
  return [n[0] / scale, n[1] / scale, n[2] / scale];
}

// The part's appearance, else its first face's. Opacity is 0-255 (older answers 0-1).
function appearanceOf(body: Body): Appearance | undefined {
  const looks = [body.appearance, ...(body.faces ?? []).map((f) => f.appearance)];
  for (const look of looks) {
    const color = look && rgb(look.color);
    if (!color) continue;
    const o = Number(look.opacity ?? 1);
    const opacity = !Number.isFinite(o) ? 1 : o > 1 ? o / 255 : o;
    return { color, opacity: Math.min(1, Math.max(0, opacity)) };
  }
  return undefined;
}

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
    if (idx.length) out.push({ partId: body.id, positions: new Float32Array(pos), indices: new Uint32Array(idx), appearance: appearanceOf(body) });
  }
  return out;
}

const pad4 = (n: number) => (n + 3) & ~3;

export function encodeMeshes(meshes: Mesh[]): Uint8Array {
  const enc = new TextEncoder();
  const ids = meshes.map((m) => enc.encode(m.partId));
  let size = 8;
  meshes.forEach((m, i) => (size += 4 + pad4(ids[i].length) + 8 + 8 + m.positions.byteLength + m.indices.byteLength));
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
    const a = m.appearance;
    view.setUint32(o, a ? 1 : 0, true);
    if (a) [...a.color, a.opacity].forEach((v, j) => view.setUint8(o + 4 + j, Math.round(v * 255)));
    o += 8;
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
  const magic = buf.byteLength < 8 ? 0 : view.getUint32(0, true);
  if (magic !== MAGIC && magic !== MAGIC_V1) throw new Error("Not a robot model file.");
  const dec = new TextDecoder();
  const count = view.getUint32(4, true);
  const out: Mesh[] = [];
  let o = 8;
  for (let i = 0; i < count; i++) {
    const len = view.getUint32(o, true);
    const partId = dec.decode(new Uint8Array(buf, o + 4, len));
    o += 4 + pad4(len);
    let appearance: Appearance | undefined;
    if (magic === MAGIC) {
      if (view.getUint32(o, true) === 1) {
        const [r, g, b, a] = [0, 1, 2, 3].map((j) => view.getUint8(o + 4 + j) / 255);
        appearance = { color: [r, g, b], opacity: a };
      }
      o += 8;
    }
    const nv = view.getUint32(o, true);
    const ni = view.getUint32(o + 4, true);
    o += 8;
    const positions = new Float32Array(buf, o, nv * 3);
    o += nv * 12;
    const indices = new Uint32Array(buf, o, ni);
    o += ni * 4;
    out.push({ partId, positions, indices, ...(appearance && { appearance }) });
  }
  return out;
}
