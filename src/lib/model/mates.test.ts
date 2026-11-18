import { expect, it } from "vitest";
import { createKinematics } from "./kinematics";
import { applyLimits, quantity, readMates } from "./mates";
import type { AssemblyDefinition } from "./assembly";

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const at = (x: number, y: number, z: number) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const cs = (o: number[]) => ({ origin: o, xAxis: [1, 0, 0], yAxis: [0, 1, 0], zAxis: [0, 0, 1] });
const part = (id: string) => ({ id, type: "Part", documentId: "d", elementId: "ps", partId: id });

// Frame F, a sub-assembly S (arm A fastened to B, which turns on S's own pivot P), and a group.
const def: AssemblyDefinition = {
  rootAssembly: {
    instances: [part("F"), part("G"), { id: "S", type: "Assembly", documentId: "d", elementId: "sub" }],
    occurrences: [
      { path: ["F"], transform: I },
      { path: ["G"], transform: at(1, 0, 0) },
      { path: ["S"], transform: I },
      { path: ["S", "P"], transform: I },
      { path: ["S", "A"], transform: at(0, 0, 0.5) },
      { path: ["S", "B"], transform: at(0, 0, 0.5) },
      { path: ["S", "L"], transform: at(0, 1, 0) },
    ],
    features: [
      { id: "g1", featureType: "mateGroup", featureData: { occurrences: [{ occurrence: ["F"] }, { occurrence: ["G"] }] } },
      { id: "m1", featureType: "mate", featureData: { name: "Fasten S", mateType: "FASTENED", matedEntities: [{ matedOccurrence: ["F"], matedCS: cs([0, 0, 0]) }, { matedOccurrence: ["S", "P"], matedCS: cs([0, 0, 0]) }] } },
    ],
  },
  subAssemblies: [
    {
      documentId: "d",
      elementId: "sub",
      instances: [part("P"), part("A"), part("B"), part("L")],
      features: [
        { id: "r1", featureType: "mate", featureData: { name: "Arm pivot", mateType: "REVOLUTE", matedEntities: [{ matedOccurrence: ["P"], matedCS: cs([0, 0, 0.5]) }, { matedOccurrence: ["A"], matedCS: cs([0, 0, 0]) }] } },
        { id: "f2", featureType: "mate", featureData: { name: "Fasten B", mateType: "FASTENED", matedEntities: [{ matedOccurrence: ["A"], matedCS: cs([0, 0, 0]) }, { matedOccurrence: ["B"], matedCS: cs([0, 0, 0]) }] } },
      ],
    },
  ],
};

it("reads groups, fastened mates, a sub-assembly's moving mate and its loose parts", () => {
  const placed = [["F"], ["G"], ["S", "P"], ["S", "A"], ["S", "B"], ["S", "L"]];
  const m = readMates(def, placed);
  const [f, g, p, a, b, l] = m.bodies;
  expect(g).toBe(f); // grouped
  expect(p).toBe(f); // fastened at the root
  expect(l).toBe(p); // unmated in S: goes with S's main piece
  expect(b).toBe(a); // fastened in S
  expect(a).not.toBe(p);
  expect(m.joints).toHaveLength(1);
  expect(m.joints[0]).toMatchObject({ id: "S/r1", name: "Arm pivot", type: "revolute", a: p, b: a });
  expect(m.joints[0].f).toEqual(at(0, 0, 0.5));
  expect(m.asks).toEqual([{ did: "d", eid: "sub", microversion: undefined, configuration: undefined, root: false, joints: [{ featureId: "r1", joint: 0, cad: { turn: 0, slide: 0 } }] }]);

  // Limits as moves from the CAD place; the arm turns its whole body, the frame stays.
  applyLimits(m.joints, m.asks[0], { features: [{ message: { featureId: "r1", parameters: [{ message: { parameterId: "limitsEnabled", value: true } }, { message: { parameterId: "limitAxialZMin", expression: "-10 deg" } }, { message: { parameterId: "limitAxialZMax", expression: "90 deg" } }] } }] });
  expect(m.joints[0].lim?.turn?.map((x) => Math.round((x * 180) / Math.PI))).toEqual([-10, 90]);
  const k = createKinematics(m.joints, []);
  expect(k.driver(a)).toBe(0);
  expect(k.driver(p)).toBeNull();
  k.set(0, "turn", 3); // clamped to 90°
  expect((k.value(0).turn * 180) / Math.PI).toBeCloseTo(90);
  expect([...k.moves().keys()]).toEqual([a]);
  expect(quantity("1.5 in")).toBeCloseTo(0.0381);
  expect(quantity("#armMax")).toBeNull();
});
