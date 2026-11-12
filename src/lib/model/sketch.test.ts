import { describe, expect, it } from "vitest";
import { sketchFromAnswers, sketchTopology } from "./sketch";

describe("Geometry sketches", () => {
  it("turns tessellated entities into lines, circles and points", () => {
    const s = sketchFromAnswers(
      "F1",
      "Geometry",
      {
        sketchEntities: [
          { entityId: "line", tessellationPoints: [[0, 0, 0], [0.1, 0, 0]] },
          { entityId: "circle", tessellationPoints: Array.from({ length: 33 }, (_, i) => [0.05 * Math.cos((i / 32) * 2 * Math.PI), 0.05 * Math.sin((i / 32) * 2 * Math.PI), 0]) },
          { entityId: "pt", tessellationPoints: [[0.2, 0.2, 0]] },
          { entityId: "guide", tessellationPoints: [[0, 0, 0], [0, 0.1, 0]] },
        ],
      },
      { sketches: [{ featureId: "F1", geomEntities: [{ id: "guide", isConstruction: true }] }] },
    );
    expect(s.entities).toHaveLength(3);
    expect(s.entities[1].closed).toBe(true);
    expect(s.entities[1].p).toHaveLength(32 * 3); // the repeated end point dropped
    expect(s.entities[2].c).toBe(true);
    expect(s.points).toEqual([0.2, 0.2, 0]);

    const t = sketchTopology(s);
    expect(t.faces).toEqual([]);
    expect(t.edges[0].kind).toBe("line");
    expect(t.edges[0].length).toBeCloseTo(0.1, 9);
    expect(t.edges[1].kind).toBe("circle");
    expect(t.edges[1].radius).toBeCloseTo(0.05, 6);
    // The point, and the ends of the open lines (the origin once).
    expect(t.corners).toHaveLength(4);
  });

  it("moves 2D points into the Part Studio by the sketch's plane", () => {
    // The Top plane turned to the Front plane: sketch y → Part Studio z, raised 1 m along y.
    const m = [1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1];
    const s = sketchFromAnswers("F1", "Front", { sketchEntities: [{ entityId: "a", tessellationPoints: [[0, 0], [0, 0.5]] }] }, { sketches: [{ sketchId: "F1", transformMatrix: m }] });
    expect(s.entities[0].p).toEqual([0, 1, 0, 0, 1, 0.5]);
  });
});
