import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { describe, expect, it } from "vitest";
import { crossDepth, expectedOverlap, findClashes, type ClashInstance } from "./clash";
import { densityOf } from "./density";
import { buildEnvelope, hull, minRect, outside, perimeter } from "./envelope";
import { meshVolume, weigh } from "./weight";

// A box of w × h × d metres centred at (x, y, z), with its BVH as load.ts gives it.
function box(key: string, w: number, h: number, d: number, x: number, y = 0, z = 0, name = key): ClashInstance {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.boundsTree = new MeshBVH(geometry);
  return { key, name, geometry, matrix: new THREE.Matrix4().makeTranslation(x, y, z), flat: () => true };
}

describe("interference", () => {
  it("finds two boxes overlapping by 2 mm, how deep and where", async () => {
    const c = await findClashes([box("a", 0.1, 0.1, 0.1, 0), box("b", 0.1, 0.1, 0.1, 0.098)]);
    expect(c).toHaveLength(1);
    expect(c[0].depthMm).toBeLessThan(2.5);
    expect(c[0].at[0]).toBeGreaterThan(45);
    expect(c[0].at[0]).toBeLessThan(55);
    expect(c[0].expected).toBeNull();
  });

  it("leaves parts that only touch, or stand apart", async () => {
    expect(await findClashes([box("a", 0.1, 0.1, 0.1, 0), box("b", 0.1, 0.1, 0.1, 0.1)])).toHaveLength(0);
    expect(await findClashes([box("a", 0.1, 0.1, 0.1, 0), box("b", 0.1, 0.1, 0.1, 0.2)])).toHaveLength(0);
    // Face to face and offset sideways (a plate bolted on a tube).
    expect(await findClashes([box("a", 0.1, 0.1, 0.1, 0), box("b", 0.05, 0.05, 0.05, 0.075, 0.02, 0.01)])).toHaveLength(0);
  });

  it("leaves a bellypan touching a tube from below, their edges only meeting on a line", async () => {
    const belly = box("belly", 0.6, 0.6, 0.003, 0.35, 0.35, -0.0015);
    const tube = box("tube", 0.0508, 0.65, 0.0254, 0.05, 0.35, 0.0127);
    expect(await findClashes([belly, tube])).toHaveLength(0);
    expect(await findClashes([tube, belly])).toHaveLength(0);
    const tubeIn = box("tube", 0.0508, 0.65, 0.0254, 0.05, 0.35, 0.0117); // 1 mm into the bellypan
    const c = await findClashes([belly, tubeIn]);
    expect(c).toHaveLength(1);
    expect(c[0].depthMm).toBeGreaterThan(0.5);
  });

  it("finds a part poking into another and a part placed twice in one spot", async () => {
    const plate = box("plate", 0.2, 0.006, 0.1, 0);
    const pin = box("pin", 0.01, 0.05, 0.01, 0.02, 0.02); // goes into the plate 2 mm (its bottom at y = -0.005)
    const c = await findClashes([plate, pin]);
    expect(c).toHaveLength(1);
    expect(c[0].depthMm).toBeGreaterThan(1.5);
    const twice = box("x", 0.05, 0.05, 0.05, 0);
    const same = await findClashes([twice, { ...twice }]);
    expect(same[0].same).toBe(true);
  });

  it("skips ignored pairs and marks screws as expected", async () => {
    const pair = [box("a", 0.1, 0.1, 0.1, 0), box("b", 0.1, 0.1, 0.1, 0.098, 0, 0, "SHCS #10-32 x 1.0")];
    expect((await findClashes(pair))[0].expected).toBe("screw or insert");
    expect(await findClashes(pair, { ignored: new Set(["a|b"]) })).toHaveLength(0);
    expect(expectedOverlap("M5 x 12 button head")).toBe("screw or insert");
    expect(expectedOverlap("36T HTD pulley")).toBe("gear, belt or chain");
    expect(expectedOverlap("Side plate")).toBeNull();
  });

  it("only counts triangles going through each other", () => {
    const t = (a: number[], b: number[], c: number[]) => new THREE.Triangle(new THREE.Vector3(...a), new THREE.Vector3(...b), new THREE.Vector3(...c));
    expect(crossDepth(t([0, 0, 0], [1, 0, 0], [0, 1, 0]), t([0.2, 0.2, -0.1], [0.2, 0.2, 0.3], [0.3, 0.2, 0]))).toBeCloseTo(0.1);
    expect(crossDepth(t([0, 0, 0], [1, 0, 0], [0, 1, 0]), t([0.2, 0.2, 0], [0.2, 0.2, 0.3], [0.3, 0.2, 0]))).toBe(0);
  });
});

describe("weight", () => {
  it("measures a mesh's volume and weighs it by material", () => {
    const g = new THREE.BoxGeometry(0.1, 0.1, 0.1); // 1000 cm³
    const v = meshVolume(g.attributes.position.array, g.index!.array) * 1e6;
    expect(v).toBeCloseTo(1000, 3);
    const facts = new Map([
      ["al", { material: "6061 Aluminum Plate 1/4\"", onshapeMaterial: null, printed: false, setG: null }],
      ["pla", { material: "PLA", onshapeMaterial: null, printed: true, setG: null }],
      ["motor", { material: null, onshapeMaterial: "Aluminum - 6061", printed: false, setG: 540 }],
    ]);
    const w = weigh(
      [
        { key: "al", name: "Plate", systemId: "s1", count: 2, volumeCm3: 100 },
        { key: "pla", name: "Bracket", systemId: "s1", count: 1, volumeCm3: 10 },
        { key: "motor", name: "Kraken", systemId: "s2", count: 1, volumeCm3: 300 },
        { key: "x", name: "Mystery", systemId: null, count: 1, volumeCm3: 1 },
      ],
      facts,
    );
    expect(w.parts.find((p) => p.key === "al")).toMatchObject({ eachG: 270, source: "material" });
    expect(w.parts.find((p) => p.key === "pla")?.source).toBe("printed");
    expect(w.parts.find((p) => p.key === "motor")).toMatchObject({ eachG: 540, source: "set" });
    expect(w.parts.find((p) => p.key === "x")?.source).toBe("guess");
    expect(w.parts[0].key).toBe("al"); // 540 g in all, before the 540 g motor (sorted stable) or equal
    expect(w.totalG).toBe(Math.round(540 + 10 * 1.24 * 0.6 + 540 + 2.7));
    expect(w.bySystem.find((s) => s.systemId === "s2")?.g).toBe(540);
  });

  it("knows the usual materials", () => {
    expect(densityOf("Aluminum - 7075")).toBe(2.81);
    expect(densityOf("Stainless Steel")).toBe(8.0);
    expect(densityOf("Polycarbonate 1/8\"")).toBe(1.2);
    expect(densityOf("Aluminum plate")).toBe(2.7);
    expect(densityOf("Unknown", "Steel")).toBe(7.85);
    expect(densityOf("plate")).toBeNull();
  });
});

describe("frame perimeter", () => {
  it("hulls, measures and finds what sticks out", () => {
    const sq = hull([0, 0, 700, 0, 700, 700, 0, 700, 350, 350, 100, 0]);
    expect(sq).toHaveLength(8);
    expect(perimeter(sq)).toBeCloseTo(2800);
    expect(minRect(hull([0, 0, 800, 0, 800, 600, 0, 600]))).toEqual({ length: 800, width: 600 });
    expect(outside(sq, 750, 350)).toBeCloseTo(50);
    expect(outside(sq, 350, 350)).toBeLessThan(0);
    const env = buildEnvelope(
      [
        { key: "frame", name: "Frame", outline: [0, 0, 700, 0, 700, 700, 0, 700], frame: [0, 0, 700, 0, 700, 700, 0, 700] },
        { key: "intake", name: "Intake", outline: [100, 650, 600, 650, 600, 800, 100, 800], frame: [] },
      ],
      900,
    )!;
    expect(env.perimeterMm).toBeCloseTo(2800);
    expect(env.out).toEqual([{ key: "intake", name: "Intake", mm: 100 }]);
    expect(env.outlineMm).toBeGreaterThan(2800);
    expect(env.heightMm).toBe(900);
  });
});

describe("reweigh", () => {
  it("puts a set weight in and takes it out again", async () => {
    const { reweigh } = await import("./weight");
    const facts = { material: "Aluminum", onshapeMaterial: null, printed: false, setG: null };
    const w = weigh([{ key: "m", name: "Motor", systemId: "s", count: 2, volumeCm3: 100 }], new Map([["m", facts]]));
    expect(w.totalG).toBe(540);
    const set = reweigh(w, "m", 500, facts);
    expect(set.totalG).toBe(1000);
    expect(set.parts[0].source).toBe("set");
    expect(reweigh(set, "m", null, facts).totalG).toBe(540);
  });
});
