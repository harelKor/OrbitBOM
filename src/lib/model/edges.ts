// The edges a 3D view draws over a part, like Onshape's dark face borders (Harel, 2026-11-09).
// The exported meshes share vertices within one Onshape face only (mesh.ts), so a triangle side
// that no other triangle of the part uses is a face border: exactly Onshape's edges, no angle
// guessing, nothing more to download.

// Pairs of vertex indices (a, b), one pair per border segment.
export function borderEdges(indices: ArrayLike<number>, vertexCount: number): Uint32Array {
  const uses = new Map<number, number>();
  const key = (a: number, b: number) => (a < b ? a * vertexCount + b : b * vertexCount + a);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    for (const [a, b] of [
      [indices[t], indices[t + 1]],
      [indices[t + 1], indices[t + 2]],
      [indices[t + 2], indices[t]],
    ]) {
      const k = key(a, b);
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  const out: number[] = [];
  for (const [k, n] of uses) {
    if (n !== 1) continue;
    out.push(Math.floor(k / vertexCount), k % vertexCount);
  }
  return new Uint32Array(out);
}

// The border segments as line positions (xyz xyz per segment), for a LineSegments geometry.
export function edgePositions(positions: ArrayLike<number>, indices: ArrayLike<number>): Float32Array {
  const pairs = borderEdges(indices, positions.length / 3);
  const out = new Float32Array(pairs.length * 3);
  for (let i = 0; i < pairs.length; i++) {
    const v = pairs[i] * 3;
    out[i * 3] = positions[v];
    out[i * 3 + 1] = positions[v + 1];
    out[i * 3 + 2] = positions[v + 2];
  }
  return out;
}
