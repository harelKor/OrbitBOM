import { describe, expect, it } from "vitest";
import type { AssemblyData, AssemblyStep } from "@/lib/data/assembly";
import { earlierKeys, makeBook, REF_COLORS, stepKeys, stepRefsOf, subModel, wholeKeys } from "./view";

const SYS = "0b5c2a4e-1111-4222-8333-944455556666";
const step = (over: Partial<AssemblyStep>): AssemblyStep => ({
  id: Math.random().toString(36).slice(2),
  systemId: SYS,
  subCode: null,
  position: 0,
  kind: "step",
  subRef: null,
  title: "Step",
  body: "",
  critical: false,
  partKeys: [],
  stepRefs: [],
  camera: null,
  imageKey: null,
  imageUrl: null,
  tick: null,
  ...over,
});
const tick = { by: "Noa", at: "2026-11-10T10:00:00Z" };

function data(steps: AssemblyStep[]): AssemblyData {
  return {
    systems: [{ id: SYS, name: "Intake" }],
    parts: [
      { key: "a", id: "1", systemId: SYS, name: "Plate", number: "1690-26-421-01", qty: 2, sub: "42", cots: false, thumbUrl: null },
      { key: "b", id: "2", systemId: SYS, name: "Shaft", number: "1690-26-425-02", qty: 1, sub: "42", cots: false, thumbUrl: null },
      { key: "c", id: "3", systemId: SYS, name: "Tube", number: "1690-26-401-01", qty: 1, sub: null, cots: false, thumbUrl: null },
      { key: "d", id: "4", systemId: SYS, name: "Bolt", number: null, qty: 8, sub: null, cots: false, thumbUrl: null },
    ],
    subNames: { [`${SYS}:42`]: "Roller arm" },
    steps,
  };
}

describe("makeBook", () => {
  it("groups parts into sub-assemblies by code, with names", () => {
    const book = makeBook(data([]));
    expect(book.systems[0].subs).toEqual([{ code: "42", name: "Roller arm", keys: ["a", "b"] }]);
    expect(book.subOfKey.get("b")).toEqual({ systemId: SYS, sub: "42" });
    expect(book.subOfKey.has("c")).toBe(false);
    expect(book.keys({ systemId: SYS, sub: null })).toEqual(["a", "b", "c", "d"]);
  });

  it("orders columns and counts a sub-assembly step done when its steps are", () => {
    const inner1 = step({ subCode: "42", position: 1, tick });
    const inner2 = step({ subCode: "42", position: 0 });
    const sub = step({ kind: "sub", subRef: "42", position: 1 });
    const first = step({ position: 0, tick, partKeys: ["c"] });
    const book = makeBook(data([inner1, inner2, sub, first]));
    expect(book.steps({ systemId: SYS, sub: null }).map((s) => s.id)).toEqual([first.id, sub.id]);
    expect(book.steps({ systemId: SYS, sub: "42" }).map((s) => s.id)).toEqual([inner2.id, inner1.id]);
    expect(book.progress({ systemId: SYS, sub: null })).toEqual({ done: 1, total: 2 });
    inner2.tick = tick;
    expect(book.done(sub)).toBe(true);
    expect(stepKeys(book, sub)).toEqual(["a", "b"]);
    expect(earlierKeys(book, book.steps({ systemId: SYS, sub: null }), 2)).toEqual(["c", "a", "b"]);
  });

  it("uses a sub-assembly step's own tick when its sub-assembly has no steps", () => {
    const sub = step({ kind: "sub", subRef: "42" });
    const book = makeBook(data([sub]));
    expect(book.done(sub)).toBe(false);
    sub.tick = tick;
    expect(book.done(sub)).toBe(true);
  });
});

describe("steps brought in whole", () => {
  it("takes every part of the earlier step and the steps it brought in, with a colour each", () => {
    const one = step({ position: 0, partKeys: ["c"] });
    const two = step({ position: 1, partKeys: ["d"], stepRefs: [one.id] });
    const three = step({ position: 2, partKeys: ["a"], stepRefs: [two.id, "gone"] });
    const book = makeBook(data([one, two, three]));
    const list = book.steps({ systemId: SYS, sub: null });
    expect(wholeKeys(book, three).sort()).toEqual(["a", "c", "d"]);
    const refs = stepRefsOf(book, list, three);
    expect(refs.map((r) => [r.n, r.keys.sort(), r.color])).toEqual([[2, ["c", "d"], REF_COLORS[0]]]);
  });
  it("doesn't loop on steps that bring each other in", () => {
    const a = step({ partKeys: ["a"] });
    const b = step({ partKeys: ["b"], stepRefs: [a.id] });
    a.stepRefs = [b.id];
    expect(wholeKeys(makeBook(data([a, b])), a).sort()).toEqual(["a", "b"]);
  });
});

describe("subModel", () => {
  it("keeps only the parts asked for and drops unused files", () => {
    const model = { studios: ["s0", "s1", "s2"], placements: [
      { s: 0, k: "a", t: [] },
      { s: 1, k: "b", t: [] },
      { s: 1, k: "c", t: [] },
    ] };
    const m = subModel(model, ["c"]);
    expect(m.placements.map((p) => p.k)).toEqual(["c"]);
    expect(m.studios).toEqual([null, "s1", null]);
  });
  it("keeps only one system's copies of a part shared between systems (COTS)", () => {
    const model = {
      studios: ["bolts"],
      placements: [
        { s: 0, k: "bolt", t: [], g: 0 },
        { s: 0, k: "bolt", t: [], g: 1 },
      ],
      groups: [
        { systemIds: ["intake"], name: "Intake" },
        { systemIds: ["drive"], name: "Drivetrain" },
      ],
    };
    expect(subModel(model, ["bolt"], "drive").placements).toEqual([{ s: 0, k: "bolt", t: [], g: 1 }]);
    expect(subModel(model, ["bolt"]).placements).toHaveLength(2);
  });
});
