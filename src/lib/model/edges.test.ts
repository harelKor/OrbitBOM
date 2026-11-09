import { describe, expect, it } from "vitest";
import { borderEdges, edgePositions } from "./edges";

describe("3D view edges", () => {
  it("draws a face's border, not the diagonal inside it", () => {
    // One square face of two triangles: 4 border sides, the shared diagonal left out.
    const edges = borderEdges([0, 1, 2, 0, 2, 3], 4);
    const pairs = Array.from({ length: edges.length / 2 }, (_, i) => [edges[i * 2], edges[i * 2 + 1]].sort().join("-")).sort();
    expect(pairs).toEqual(["0-1", "0-3", "1-2", "2-3"]);
  });

  it("keeps two faces' borders where they meet (faces don't share vertices)", () => {
    // Two triangles side by side, each its own face: the meeting side shows twice (once per face).
    const edges = borderEdges([0, 1, 2, 3, 4, 5], 6);
    expect(edges.length / 2).toBe(6);
  });

  it("gives xyz pairs for the lines", () => {
    const pos = [0, 0, 0, 1, 0, 0, 1, 1, 0];
    expect(Array.from(edgePositions(pos, [0, 1, 2]))).toHaveLength(3 * 2 * 3);
  });
});
