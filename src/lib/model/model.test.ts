import { expect, it } from "vitest";
import { flattenAssembly, partKey } from "./assembly";
import { decodeMeshes, encodeMeshes, meshesFromTessellation } from "./mesh";

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const moved = [1, 0, 0, 0.1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

it("flattens nested subassemblies to one placement per visible part", () => {
  const placements = flattenAssembly({
    rootAssembly: {
      instances: [
        { id: "A", type: "Part", documentId: "d1", documentMicroversion: "m1", elementId: "e1", partId: "JHD" },
        { id: "B", type: "Assembly", documentId: "d1", documentMicroversion: "m1", elementId: "asm2" },
        { id: "C", type: "Part", documentId: "d1", elementId: "e1", partId: "JKD", suppressed: true },
      ],
      occurrences: [
        { path: ["A"], transform: I },
        { path: ["B"], transform: I },
        { path: ["B", "X"], transform: moved },
        { path: ["B", "Y"], transform: moved, hidden: true },
        { path: ["C"], transform: I },
      ],
    },
    subAssemblies: [
      {
        documentId: "d1",
        elementId: "asm2",
        documentMicroversion: "m1",
        instances: [
          { id: "X", type: "Part", documentId: "d9", documentVersion: "v9", elementId: "e9", partId: "JFD", configuration: "Length%3D2" },
          { id: "Y", type: "Part", documentId: "d9", elementId: "e9", partId: "JFH" },
        ],
      },
    ],
  });
  expect(placements).toEqual([
    { studio: { did: "d1", eid: "e1", microversion: "m1" }, partId: "JHD", transform: I },
    { studio: { did: "d9", eid: "e9", version: "v9", configuration: "Length%3D2" }, partId: "JFD", transform: moved },
  ]);
  expect(partKey("d9", "e9", "JFD")).toBe("d9:e9:JFD");
});

it("turns tessellated faces into meshes that survive the binary file", () => {
  const tri = (z: number) => ({ vertices: [[0, 0, z], [1, 0, z], [0, 1, z]] });
  const meshes = meshesFromTessellation([
    { id: "JHD", faces: [{ facets: [tri(0), { vertices: [[1, 0, 0], [1, 1, 0], [0, 1, 0]] }] }, { facets: [tri(1)] }] },
    { id: "JKD", facetPoints: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }], faces: [{ facets: [{ indices: [0, 1, 2] }] }] },
    { id: "EMPTY", faces: [] },
  ]);
  expect(meshes.map((m) => [m.partId, m.positions.length / 3, m.indices.length])).toEqual([
    ["JHD", 7, 9], // 4 shared in face 1, 3 in face 2
    ["JKD", 3, 3],
  ]);
  const back = decodeMeshes(encodeMeshes(meshes).slice().buffer);
  expect(back.map((m) => m.partId)).toEqual(["JHD", "JKD"]);
  expect([...back[1].positions]).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  expect([...back[0].indices]).toEqual([...meshes[0].indices]);
});

it("keeps Onshape's appearance, opacity included", () => {
  const facets = [{ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }];
  const meshes = meshesFromTessellation([
    { id: "A", faces: [{ facets }], appearance: { color: [255, 0, 51], opacity: 128 } },
    { id: "B", faces: [{ facets }] },
  ]);
  const back = decodeMeshes(encodeMeshes(meshes).slice().buffer);
  expect(back[0].appearance?.color).toEqual([1, 0, 0.2]);
  expect(back[0].appearance?.opacity).toBeCloseTo(0.5, 2);
  expect(back[1].appearance).toBeUndefined();
});
