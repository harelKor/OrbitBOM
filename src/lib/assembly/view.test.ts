import { describe, expect, it } from "vitest";
import type { AssemblyData, AssemblyStep } from "@/lib/data/assembly";
import { earlierKeys, makeBook, stepKeys, subModel } from "./view";

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
      { key: "a", id: "1", systemId: SYS, name: "Plate", number: "1690-26-421-01", qty: 2, sub: "42" },
      { key: "b", id: "2", systemId: SYS, name: "Shaft", number: "1690-26-425-02", qty: 1, sub: "42" },
      { key: "c", id: "3", systemId: SYS, name: "Tube", number: "1690-26-401-01", qty: 1, sub: null },
      { key: "d", id: "4", systemId: SYS, name: "Bolt", number: null, qty: 8, sub: null },
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
});
