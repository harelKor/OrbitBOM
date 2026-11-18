import { describe, expect, it } from "vitest";
import { topology, type V3 } from "@/lib/model/topology";
import { cleanAnchor, findAnchor, sigOf } from "./anchor";

// A box as Onshape exports it (each face its own vertices), faces in the order given.
function mesh(faces: { pts: V3[]; tris: number[][] }[]) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const f of faces) {
    const base = pos.length / 3;
    for (const p of f.pts) pos.push(...p);
    for (const t of f.tris) idx.push(...t.map((i) => base + i));
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
const quad = (a: V3, b: V3, c: V3, d: V3) => ({ pts: [a, b, c, d], tris: [[0, 1, 2], [0, 2, 3]] });
const faces = (x: number, y: number, z: number) => [
  quad([0, 0, z], [x, 0, z], [x, y, z], [0, y, z]), // top
  quad([0, y, 0], [x, y, 0], [x, 0, 0], [0, 0, 0]), // bottom
  quad([0, 0, 0], [x, 0, 0], [x, 0, z], [0, 0, z]),
  quad([0, y, z], [x, y, z], [x, y, 0], [0, y, 0]),
  quad([x, 0, 0], [x, y, 0], [x, y, z], [x, 0, z]),
  quad([0, 0, z], [0, y, z], [0, y, 0], [0, 0, 0]),
];
const part = (f: ReturnType<typeof faces>) => {
  const m = mesh(f);
  return { ...m, t: topology(m.pos, m.idx) };
};

describe("comment anchors", () => {
  const a = part(faces(0.1, 0.05, 0.01));
  const top = a.t.faces.findIndex((f) => f.normal && f.normal[2] > 0.9);

  it("describes a face in mm in the part's frame", () => {
    const s = sigOf(a.t, a.pos, a.idx, "face", top)!;
    expect(s.k).toBe("plane");
    expect(s.c).toEqual([50, 25, 10]);
    expect(s.s).toBeCloseTo(5000, 0);
  });

  it("keeps the same number while the mesh is the same", () => {
    const sig = sigOf(a.t, a.pos, a.idx, "face", top)!;
    expect(findAnchor(a.t, a.pos, a.idx, { kind: "face", n: top, sig })).toBe(top);
  });

  it("finds the face again when the faces come in another order", () => {
    const sig = sigOf(a.t, a.pos, a.idx, "face", top)!;
    const b = part([...faces(0.1, 0.05, 0.01)].reverse());
    const n = findAnchor(b.t, b.pos, b.idx, { kind: "face", n: top, sig });
    expect(n).not.toBe(top);
    expect(b.t.faces[n].normal![2]).toBeGreaterThan(0.9);
  });

  it("follows a slightly thicker part, and gives up on one that changed a lot", () => {
    const sig = sigOf(a.t, a.pos, a.idx, "face", top)!;
    const thicker = part(faces(0.1, 0.05, 0.012));
    expect(thicker.t.faces[findAnchor(thicker.t, thicker.pos, thicker.idx, { kind: "face", n: 99, sig })].normal![2]).toBeGreaterThan(0.9);
    const other = part(faces(0.4, 0.3, 0.2));
    expect(findAnchor(other.t, other.pos, other.idx, { kind: "face", n: 99, sig })).toBe(-1);
  });

  it("finds an edge again", () => {
    const e = a.t.edges.findIndex((x) => x.kind === "line" && x.length > 0.09);
    const sig = sigOf(a.t, a.pos, a.idx, "edge", e)!;
    expect(sig.s).toBeCloseTo(100, 0);
    const b = part([...faces(0.1, 0.05, 0.01)].reverse());
    const n = findAnchor(b.t, b.pos, b.idx, { kind: "edge", n: e, sig });
    expect(n).toBeGreaterThanOrEqual(0);
    expect(sigOf(b.t, b.pos, b.idx, "edge", n)!.c).toEqual(sig.c);
  });

  it("checks what a browser sends", () => {
    const good = { key: "d:e:p", kind: "edge", n: 3, sig: { k: "line", c: [1, 2, 3.333], d: [1, 0, 0], s: 100 }, at: [10, 20, 30.456] };
    expect(cleanAnchor(good)).toEqual({ ...good, sig: { ...good.sig, c: [1, 2, 3.33] }, at: [10, 20, 30.46] });
    expect(cleanAnchor({ ...good, kind: "solid" })).toBeNull();
    expect(cleanAnchor({ ...good, at: [1, 2] })).toBeNull();
    expect(cleanAnchor({ ...good, sig: { ...good.sig, k: "<script>" } })).toBeNull();
    expect(cleanAnchor(null)).toBeNull();
  });
});
