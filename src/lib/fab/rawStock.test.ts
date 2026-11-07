import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import type { InvCategory } from "@/lib/inventory/categories";
import { cutLengths, nestOnSheets } from "./layout";
import { groupRawStock, isMade, parseCustomSize, planGroup, type RawPartRow } from "./rawStock";

const cats: InvCategory[] = DEFAULT_CATEGORIES.map((c) => ({ id: c.id, label: c.label, noun: c.noun, group: c.group, sheet: !!c.sheet, image: null, defaultLocationId: null, fields: c.fields }));

const row = (id: string, over: Partial<RawPartRow> = {}): RawPartRow => ({
  id,
  name: id,
  systemName: "Drive",
  material: null,
  inventoryItemId: null,
  geometry: null,
  classification: "inhouse",
  quantity: 1,
  designState: null,
  preProcess: null,
  process1: null,
  process2: null,
  donePreprocess: 0,
  doneProcess1: 0,
  doneProcess2: 0,
  ...over,
});

describe("cutLengths", () => {
  it("cuts longest first into the first bar it fits, with a kerf per cut", () => {
    const { bars, tooLong } = cutLengths(
      [
        { partId: "a", length: 600, quantity: 2 },
        { partId: "b", length: 390, quantity: 2 },
        { partId: "c", length: 1200, quantity: 1 },
      ],
      1000,
      3,
    );
    expect(tooLong).toEqual(["c"]);
    // 600 + 3 + 390 = 993 fits a 1000 bar, twice.
    expect(bars).toHaveLength(2);
    expect(bars[0].cuts.map((c) => [c.partId, c.start])).toEqual([
      ["a", 0],
      ["b", 603],
    ]);
  });

  it("needs no kerf after a part that ends the bar", () => {
    expect(cutLengths([{ partId: "a", length: 500, quantity: 2 }], 1003, 3).bars).toHaveLength(1);
    expect(cutLengths([{ partId: "a", length: 500, quantity: 2 }], 1002, 3).bars).toHaveLength(2);
  });
});

describe("nestOnSheets", () => {
  it("fills sheet after sheet and leaves out parts too big for one", () => {
    const { sheets, tooBig } = nestOnSheets(
      [
        { partId: "a", w: 200, h: 200, quantity: 6 },
        { partId: "big", w: 2000, h: 100, quantity: 1 },
      ],
      500,
      450,
      0,
      0,
    );
    expect(tooBig).toEqual(["big"]);
    // Four 200×200 fit on a 500×450 sheet; six take two.
    expect(sheets.map((s) => s.placements.length)).toEqual([4, 2]);
  });
});

describe("groupRawStock", () => {
  const plate = { id: "i1", name: "3mm 6061 plate", category: "aluminum-plates", specs: { thickness: "3", size: "1000x1200" }, inStock: 1.5, pieces: [] };
  const tube = { id: "i2", name: "Aluminum 40x20x2 box tube", category: "square-tubes", specs: { length: "1500" }, inStock: 2, pieces: [] };
  const pla = { id: "i3", name: "PLA black", category: "filament", specs: {}, inStock: 1, pieces: [] };

  it("groups by linked item, then by material and shape, and skips filament", () => {
    const groups = groupRawStock(
      [
        row("p1", { inventoryItemId: "i1", quantity: 2, geometry: { shape: { kind: "plate", t: 3, d1: 100, d2: 300 } } }),
        row("p2", { inventoryItemId: "i1", designState: "In Stock", geometry: { bbox: [3, 50, 80] } }),
        row("t1", { inventoryItemId: "i2", geometry: { shape: { kind: "box-tube", d1: 20, d2: 40, wall: 2, length: 700 } } }),
        row("x1", { inventoryItemId: "i3", geometry: { shape: { kind: "plate", t: 3, d1: 10, d2: 10 } } }),
        row("u1", { material: "Polycarbonate", geometry: { shape: { kind: "plate", t: 2, d1: 100, d2: 100 } } }),
        row("u2", { material: "Polycarbonate", geometry: { shape: { kind: "plate", t: 2, d1: 50, d2: 60 } } }),
        row("u3", { material: "Polycarbonate", process1: "3d-bambu", geometry: { shape: { kind: "plate", t: 2, d1: 50, d2: 60 } } }),
        row("n1", { inventoryItemId: "i1" }),
      ],
      [plate, tube, pla],
      cats,
      { i2: "m1000" },
    );
    expect(groups.map((g) => g.key)).toEqual(["i1", "i2", "auto:plate|Polycarbonate|2"]);
    const [p, t, auto] = groups;
    expect(p.kind).toBe("plate");
    expect(p.size).toBe("p1000x1200");
    expect(p.parts.map((x) => [x.partId, x.w, x.h, x.approx, x.made])).toEqual([
      ["p1", 300, 100, false, false],
      ["p2", 80, 50, true, true],
    ]);
    expect(p.missing.map((m) => m.partId)).toEqual(["n1"]);
    expect(t).toMatchObject({ kind: "length", size: "m1000" });
    expect(auto.parts.map((x) => x.partId).sort()).toEqual(["u1", "u2"]);
  });
});

describe("planGroup", () => {
  it("counts pieces, usage and what's made", () => {
    const parts = [
      { partId: "a", name: "a", systemName: "", quantity: 3, status: "In Stock", color: "", made: true, w: 400, h: 0, approx: false },
      { partId: "b", name: "b", systemName: "", quantity: 1, status: "Released", color: "", made: false, w: 400, h: 0, approx: false },
    ];
    const plan = planGroup({ kind: "length", parts }, "m1000");
    expect(plan.pieces).toHaveLength(2);
    expect(plan.usage).toBeCloseTo(0.8);
    expect([plan.madeCopies, plan.copies]).toEqual([3, 4]);
  });
});

describe("helpers", () => {
  it("reads made statuses and typed sizes", () => {
    expect(isMade("Post Processing")).toBe(true);
    expect(isMade("In Stock")).toBe(true);
    expect(isMade("In Factory")).toBe(false);
    expect(isMade("Ready for Process 2")).toBe(false);
    expect(parseCustomSize("500 x 900", "plate")).toBe("p500x900");
    expect(parseCustomSize("1000", "length")).toBe("m1000");
    expect(parseCustomSize("1000", "plate")).toBeNull();
  });
});

describe("planGroup with real outlines", () => {
  it("nests by the flat size and places each outline inside its box", async () => {
    const { flattenMesh, placePoint } = await import("./layout");
    // An L-shaped 3 mm plate, 200 × 120 (metres, as the mesh files hold them).
    const pts: [number, number][] = [
      [0, 0],
      [200, 0],
      [200, 40],
      [60, 40],
      [60, 120],
      [0, 120],
    ];
    const positions: number[] = [];
    for (const z of [0, 3]) for (const [x, y] of pts) positions.push(x / 1000, y / 1000, z / 1000);
    const n = pts.length;
    const indices: number[] = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];
    indices.push(...indices.map((i) => i + n));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      indices.push(i, j, j + n, i, j + n, i + n);
    }
    const flat = flattenMesh(new Float32Array(positions), new Uint32Array(indices))!;
    expect([Math.round(flat.w), Math.round(flat.h)]).toEqual([200, 120]);
    const part = { partId: "L", name: "L", systemName: "", quantity: 5, status: "Released", color: "", made: false, w: 999, h: 999, approx: true };
    const plan = planGroup({ kind: "plate", parts: [part] }, "p500x450", new Map([["L", flat]]));
    expect(plan.pieces.flatMap((p) => p.items)).toHaveLength(5);
    for (const it of plan.pieces.flatMap((p) => p.items)) {
      for (const pt of flat.outline) {
        const [x, y] = placePoint(pt, it.place!);
        expect(x).toBeGreaterThanOrEqual(it.x - 0.01);
        expect(x).toBeLessThanOrEqual(it.x + it.w + 0.01);
        expect(y).toBeGreaterThanOrEqual(it.y - 0.01);
        expect(y).toBeLessThanOrEqual(it.y + it.h + 0.01);
      }
    }
  });
});
