import { describe, expect, it } from "vitest";
import { analyzeShape } from "./shape";
import { suggestSetup, type SetupInput, type StockItem } from "./rules";

type P = [number, number];
type V = [number, number, number];

// Closed solids in mm, outward-facing triangles; returned in metres like the .obm file.
class Solid {
  pos: number[] = [];
  idx: number[] = [];
  tri(a: V, b: V, c: V) {
    const i = this.pos.length / 3;
    this.pos.push(...a, ...b, ...c);
    this.idx.push(i, i + 1, i + 2);
  }
  quad(a: V, b: V, c: V, d: V) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }
  // Side walls of a CCW outline from z0 to z1; `inward` for a hole's walls.
  walls(o: P[], z0: number, z1: number, inward = false) {
    o.forEach((a, k) => {
      const b = o[(k + 1) % o.length];
      if (inward) this.quad([b[0], b[1], z0], [a[0], a[1], z0], [a[0], a[1], z1], [b[0], b[1], z1]);
      else this.quad([a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]);
    });
  }
  // A face at height z: the outline, or the ring between outline and hole (same vertex count).
  cap(o: P[], z: number, up: boolean, hole?: P[]) {
    o.forEach((a, k) => {
      const b = o[(k + 1) % o.length];
      if (hole) {
        const [c, d] = [hole[(k + 1) % hole.length], hole[k]];
        if (up) this.quad([a[0], a[1], z], [b[0], b[1], z], [c[0], c[1], z], [d[0], d[1], z]);
        else this.quad([d[0], d[1], z], [c[0], c[1], z], [b[0], b[1], z], [a[0], a[1], z]);
      } else if (k > 0 && k < o.length - 1) {
        const p0 = o[0];
        if (up) this.tri([p0[0], p0[1], z], [a[0], a[1], z], [b[0], b[1], z]);
        else this.tri([p0[0], p0[1], z], [b[0], b[1], z], [a[0], a[1], z]);
      }
    });
  }
  // Rotated by `deg` about an oblique axis, so nothing lines up with the Part Studio's axes.
  mesh(deg = 0) {
    const t = (deg * Math.PI) / 180;
    const [c, s] = [Math.cos(t), Math.sin(t)];
    const out: number[] = [];
    for (let i = 0; i < this.pos.length; i += 3) {
      const [x, y, z] = [this.pos[i], this.pos[i + 1], this.pos[i + 2]];
      // about z, then about x
      const x1 = c * x - s * y;
      const y1 = s * x + c * y;
      out.push(x1 / 1000, (c * y1 - s * z) / 1000, (s * y1 + c * z) / 1000);
    }
    return { positions: out, indices: this.idx };
  }
}

function prism(outline: P[], len: number, hole?: P[]) {
  const s = new Solid();
  s.walls(outline, 0, len);
  if (hole) s.walls(hole, 0, len, true);
  s.cap(outline, 0, false, hole);
  s.cap(outline, len, true, hole);
  return s;
}
const rect = (w: number, h: number, x = 0, y = 0): P[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
const circle = (d: number, n = 72): P[] => Array.from({ length: n }, (_, k) => [(d / 2) * Math.cos((2 * Math.PI * k) / n), (d / 2) * Math.sin((2 * Math.PI * k) / n)]);
// A spur gear's outline: square teeth between the tip and root circles.
const gear = (teeth: number, od: number, root: number): P[] =>
  Array.from({ length: teeth * 4 }, (_, k) => {
    const a = (2 * Math.PI * k) / (teeth * 4);
    const r = k % 4 < 2 ? od / 2 : root / 2;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
const hexagon = (flats: number): P[] => Array.from({ length: 6 }, (_, k) => [(flats / Math.sqrt(3)) * Math.cos((Math.PI * k) / 3), (flats / Math.sqrt(3)) * Math.sin((Math.PI * k) / 3)]);

const read = (s: Solid, deg = 37) => {
  const m = s.mesh(deg);
  return analyzeShape(m.positions, m.indices)!;
};

describe("analyzeShape", () => {
  it("recognises a 1/2 inch hex shaft, at any angle", () => {
    const s = read(prism(hexagon(12.7), 200));
    expect(s.kind).toBe("hex");
    expect(s.d1).toBeCloseTo(12.7, 1);
    expect(s.d2).toBeCloseTo(14.66, 1);
    expect(s.turned).toBe(false);
    expect(read(prism(hexagon(9.525), 150)).kind).toBe("hex");
  });

  it("sees turned ends on a hex shaft", () => {
    const sol = prism(hexagon(12.7), 150);
    // A 10 mm round end on top.
    const end = circle(10, 48);
    end.forEach((a, k) => {
      const b = end[(k + 1) % end.length];
      sol.quad([a[0], a[1], 150], [b[0], b[1], 150], [b[0], b[1], 175], [a[0], a[1], 175]);
    });
    sol.cap(end, 175, true);
    expect(read(sol).turned).toBe(true);
  });

  it("recognises a 25x50x1.5 box tube and its wall", () => {
    const s = read(prism(rect(25, 50), 600, rect(22, 47, 1.5, 1.5)));
    expect(s).toMatchObject({ kind: "box-tube" });
    expect(s.d1).toBeCloseTo(25, 1);
    expect(s.d2).toBeCloseTo(50, 1);
    expect(s.wall).toBeCloseTo(1.5, 1);
  });

  it("does not take a bent angle for a box tube", () => {
    const angle: P[] = [
      [0, 0],
      [19, 0],
      [19, 2],
      [2, 2],
      [2, 19],
      [0, 19],
    ];
    const s = new Solid();
    s.walls(angle, 0, 200);
    // Caps as two rectangles.
    for (const r of [rect(19, 2), rect(2, 17, 0, 2)]) {
      s.cap(r, 0, false);
      s.cap(r, 200, true);
    }
    expect(read(s).kind).not.toBe("box-tube");
  });

  it("recognises a round tube with its wall, and a solid rod", () => {
    const tube = read(prism(circle(25), 300, circle(22)));
    expect(tube.kind).toBe("round-tube");
    expect(tube.d1).toBeCloseTo(25, 0);
    expect(tube.wall).toBeCloseTo(1.5, 1);
    const rod = read(prism(circle(4, 32), 60));
    expect(rod).toMatchObject({ kind: "rod", axisymmetric: true });
    expect(rod.d1).toBeCloseTo(4, 0);
  });

  it("calls a short thick round part a turned spacer, not a plate", () => {
    const s = read(prism(circle(20, 48), 6, circle(8, 48)));
    expect(s.kind).toBe("spacer");
  });

  it("measures a rotated plate's thickness, and finds pockets", () => {
    const plain = read(prism(rect(120, 200), 3.175), 23);
    expect(plain).toMatchObject({ kind: "plate", pocketed: false });
    expect(plain.t).toBeCloseTo(3.175, 1);

    // 6 mm plate with a 60x100 pocket 4 mm deep.
    const s = new Solid();
    const outer = rect(120, 200);
    const pocket = rect(60, 100, 30, 50);
    s.walls(outer, 0, 6);
    s.cap(outer, 0, false);
    s.cap(outer, 6, true, pocket);
    s.walls(pocket, 2, 6, true);
    s.cap(pocket, 2, true);
    const p = read(s, 51);
    expect(p).toMatchObject({ kind: "plate", pocketed: true });
    expect(p.t).toBeCloseTo(6, 1);

    // A 3 mm plate with one 10x10 step 1.5 mm deep (a counterbore, a ledge) is pocketed too
    // (Harel, 2026-11-06).
    const c = new Solid();
    const plate = rect(40, 60);
    const step = rect(10, 10, 15, 25);
    c.walls(plate, 0, 3);
    c.cap(plate, 0, false);
    c.cap(plate, 3, true, step);
    c.walls(step, 1.5, 3, true);
    c.cap(step, 1.5, true);
    expect(read(c, 17)).toMatchObject({ kind: "plate", pocketed: true });
  });

  it("reads plates with big pockets as plates, not box tubes (Harel, 2026-11-13)", () => {
    // Pocketed 6.7 and 4 mm plates, and a narrow frame whose long walls outweigh its faces, all
    // read as box tubes before.
    for (const [plate, t] of [
      [prism(rect(140, 280), 6.7, rect(120, 260, 10, 10)), 6.7],
      [prism(rect(130, 230), 4, rect(110, 210, 10, 10)), 4],
      [prism(rect(40, 280), 6.7, rect(30, 270, 5, 5)), 6.7],
    ] as const) {
      const s = read(plate);
      expect(s.kind).toBe("plate");
      expect(s.t).toBeCloseTo(t, 1);
    }
  });

  it("reads a gear as a plate, not a turned spacer (Harel, 2026-11-13)", () => {
    // 42T 20DP gear, 3/8" thick, with and without a bore: CNC from plate, not the lathe.
    expect(read(prism(gear(42, 55.8, 51), 9.53))).toMatchObject({ kind: "plate", t: 9.53 });
    expect(read(prism(gear(42, 55.8, 51), 9.53, circle(12.7, 168)))).toMatchObject({ kind: "plate" });
    // A round part of the same size is still turned.
    expect(read(prism(circle(40, 168), 17.7, circle(13, 168))).kind).toBe("spacer");
  });

  it("leaves a solid block a block", () => {
    expect(read(prism(rect(30, 40), 50)).kind).toBe("block");
  });
});

// ---------- the rules on top of the shapes ----------

const item = (name: string, category: string, specs: Record<string, string> = {}): StockItem => ({ id: `id:${name}`, name, category, specs });
const STOCK: StockItem[] = [
  item("Aluminum plate 6061 3mm", "aluminum-plates", { thickness: "3", material: "3mm 6061-T6" }),
  item("Aluminum plate 7075 3mm", "aluminum-plates", { thickness: "3", material: "7075-T6" }),
  item("Aluminum plate 6061 4mm", "aluminum-plates", { thickness: "4" }),
  item("Aluminum plate 6061 6.35mm", "aluminum-plates", { thickness: "6.35" }),
  item("Aluminum plate 6061 6.7mm", "aluminum-plates", { thickness: "6.7" }),
  item("Polycarbonate 3mm", "polycarbonate", { thickness: "3" }),
  item("Aluminum box tube 25×50×1.5mm", "square-tubes", { size: "25×50", wall: "1.5", material: "Aluminum" }),
  item("Aluminum box tube 25×50×3mm", "square-tubes", { size: "25×50", wall: "3" }),
  item("50x25mm 1.5mm wall Box tube", "square-tubes", { size: "50x25", wall: "1.5" }),
  item("Aluminum box tube 15×15mm", "square-tubes", { size: "15×15" }),
  item("Carbon square tube 22×22×1.3mm", "square-tubes", { size: "22×22", wall: "1.3", material: "Carbon Fiber" }),
  item("Aluminum 25x1.5 tube", "round-tubes", { od: "25", wall: "1.5", material: "Aluminum" }),
  item("Carbon Fiber 25x1.5 tube", "round-tubes", { od: "25", wall: "1.5", material: "Carbon Fiber" }),
  item("Carbon Fiber Ø25 tube (other walls)", "round-tubes", { od: "25", material: "Carbon Fiber" }),
  item('1/2" Hex shaft', "shafts", { profile: '1/2" Hex' }),
  item('1/2" ThunderHex shaft', "shafts", { profile: '1/2" ThunderHex' }),
  item('3/8" Hex shaft', "shafts", { profile: '3/8" Hex' }),
  item("Aluminum Ø10mm cylinder", "cylinders-blocks", { shape: "Cylinder", material: "Aluminum", od: "10" }),
  item("Aluminum Ø25mm cylinder", "cylinders-blocks", { shape: "Cylinder", material: "Aluminum", od: "25" }),
  item("Brass cylinder", "cylinders-blocks", { shape: "Cylinder", material: "Brass" }),
  item("Brass block", "cylinders-blocks", { shape: "Block", material: "Brass" }),
  item("Carbon Fiber 16x1 tube", "round-tubes", { od: "16", wall: "1", material: "Carbon Fiber" }),
  item("Bambu PLA – Black filament", "filament", { material: "PLA" }),
  item("TPU filament", "filament"),
  item("Markforged Onyx filament", "filament", { material: "Onyx" }),
];
const setup = (geometry: SetupInput["geometry"], over: Partial<SetupInput> = {}) =>
  suggestSetup({ classification: "undefined", material: null, preProcess: null, process1: null, process2: null, geometry, ...over }, STOCK);
const shapeOf = (s: Solid) => read(s);

describe("suggestSetup with shapes", () => {
  it("links a part Onshape calls Aluminum - 6061 to the exact plate item", () => {
    const g = { onshapeMaterial: "Aluminum - 6061", shape: shapeOf(prism(rect(120, 200), 3.175)) };
    const s = setup(g, { material: "Aluminum - 6061" });
    expect(s?.changes).toMatchObject({ material: "Aluminum plate 6061 3mm", inventoryItemId: "id:Aluminum plate 6061 3mm", process1: "cnc", classification: "inhouse" });
  });

  it("respects the alloy and picks the closest thickness", () => {
    expect(setup({ onshapeMaterial: "Aluminum - 7075", shape: { kind: "plate", t: 3 } })?.changes.material).toBe("Aluminum plate 7075 3mm");
    expect(setup({ onshapeMaterial: "Aluminum - 6061", shape: { kind: "plate", t: 6.6 } })?.changes.material).toBe("Aluminum plate 6061 6.7mm");
    expect(setup({ onshapeMaterial: "Aluminum - 6061", shape: { kind: "plate", t: 6.4 } })?.changes.material).toBe("Aluminum plate 6061 6.35mm");
  });

  it("faces aluminium down from the next plate up, but cuts poly as it comes (Harel, 2026-11-13)", () => {
    // 3/8" parts from the 10 mm plate, a 11 mm gear hub from the 12.7 mm plate (whose thickness
    // spec says 12), 7.7 mm poly from the 8 mm sheet.
    const stock = [
      ...STOCK,
      item("10mm Aluminum plate", "aluminum-plates", { thickness: "10" }),
      item("12.7mm Aluminum plate", "aluminum-plates", { thickness: "12" }),
      item("Polycarbonate 8mm", "polycarbonate", { thickness: "8" }),
    ];
    const pick = (onshapeMaterial: string, t: number) => suggestSetup({ classification: "undefined", material: null, preProcess: null, process1: null, process2: null, geometry: { onshapeMaterial, shape: { kind: "plate", t } } }, stock)?.changes.material;
    expect(pick("Aluminum - 6061", 9.53)).toBe("10mm Aluminum plate");
    expect(pick("Aluminum - 6061", 11.09)).toBe("12.7mm Aluminum plate");
    expect(pick("Aluminum - 6061", 12.7)).toBe("12.7mm Aluminum plate");
    expect(pick("Polycarbonate", 7.7)).toBe("Polycarbonate 8mm");
    expect(pick("Polycarbonate", 6.5)).toBeUndefined();
  });

  it("sends the pocketed plate an old Suggest called a box tube to the CNC, not the laser", () => {
    // 1691-26-212-01A as it was measured: "box tube 6.7×136.8 mm, 2.8 mm wall", Laser.
    const s = setup({ onshapeMaterial: "Aluminum - 6061", bbox: [6.7, 168.35, 281.65], shape: { kind: "box-tube", d1: 6.73, d2: 136.77, wall: 2.75, length: 320.37 } });
    expect(s?.changes).toMatchObject({ material: "Aluminum plate 6061 6.7mm", process1: "cnc" });
  });

  it("finds box tubes whose size spec is one number, and takes Carbon Steel for steel", () => {
    const stock = [...STOCK, item("Box tube 50×50×2mm", "square-tubes", { size: "50", wall: "2", material: "Aluminum" }), item("Steel block", "cylinders-blocks", { shape: "Block", material: "Steel" })];
    const run = (geometry: SetupInput["geometry"]) => suggestSetup({ classification: "undefined", material: null, preProcess: null, process1: null, process2: null, geometry }, stock)?.changes;
    expect(run({ onshapeMaterial: "Aluminum - 6061", shape: { kind: "box-tube", d1: 50, d2: 50, wall: 2, length: 700 } })?.material).toBe("Box tube 50×50×2mm");
    expect(run({ onshapeMaterial: "Carbon Steel", shape: { kind: "block", size: [11.1, 12.7, 13.6] } })).toMatchObject({ material: "Steel block", process1: "cnc" });
  });

  it("sends pocketed plates to the CNC, also polycarbonate", () => {
    const s = setup({ onshapeMaterial: "Polycarbonate", shape: { kind: "plate", t: 3, pocketed: true } });
    expect(s?.changes).toMatchObject({ material: "Polycarbonate 3mm", process1: "cnc" });
    expect(setup({ onshapeMaterial: "Polycarbonate", shape: { kind: "plate", t: 3 } })?.changes.process1).toBe("laser");
  });

  it("prints PLA, TPU and Onyx parts, and never adds a second process or bending", () => {
    const pla = setup({ onshapeMaterial: "PLA", bbox: [19, 19, 200], wallMm: 2, shape: { kind: "box-tube", d1: 19, d2: 19 } });
    expect(pla?.changes).toEqual({ material: "PLA", preProcess: null, process1: "3d-bambu", process2: null, classification: "inhouse" });
    expect(setup({ onshapeMaterial: "TPU 95A" })?.changes).toMatchObject({ material: "TPU", process1: "3d-bambu", process2: null });
    expect(setup({ onshapeMaterial: "Onyx" })?.changes).toMatchObject({ material: "Onyx", process1: "3d-markforged" });
    // Sheet metal printed in PLA is still only printed.
    const s = setup({ onshapeMaterial: "PLA", sheetMetal: { flatPartId: "x" }, wallMm: 2 });
    expect(s?.changes).toMatchObject({ process1: "3d-bambu", process2: null, preProcess: null });
  });

  it("links a hex shaft to its shaft item before any plate rule", () => {
    const g = { onshapeMaterial: "Steel", shape: shapeOf(prism(hexagon(12.7), 200)) };
    expect(setup(g)?.changes).toMatchObject({ material: '1/2" Hex shaft', process1: "manual-mill" });
    expect(setup({ onshapeMaterial: "Aluminum - 7075", shape: { kind: "hex", d1: 12.7, d2: 13.8, thunder: true, turned: true } })?.changes).toMatchObject({
      material: '1/2" ThunderHex shaft',
      process1: "lathe",
    });
    expect(setup({ shape: { kind: "hex", d1: 9.5, d2: 11 } })?.changes.material).toBe('3/8" Hex shaft');
  });

  it("links box tubes by size and wall, not as bent sheet", () => {
    const g = { onshapeMaterial: "Aluminum - 6061", bbox: [25, 50, 600] as [number, number, number], wallMm: 1.5, shape: shapeOf(prism(rect(25, 50), 600, rect(22, 47, 1.5, 1.5))) };
    const s = setup(g);
    expect(s?.changes.material).toMatch(/25×50×1.5mm|50x25mm 1.5mm wall/);
    expect(s?.changes.process2).toBeNull();
    expect(setup({ onshapeMaterial: "Aluminum - 6061", shape: { kind: "box-tube", d1: 25.4, d2: 50.8, wall: 3.2 } })?.changes.material).toBe("Aluminum box tube 25×50×3mm");
    expect(setup({ onshapeMaterial: "Aluminum - 6061", shape: { kind: "box-tube", d1: 15, d2: 15, wall: 1 } })?.changes.material).toBe("Aluminum box tube 15×15mm");
    expect(setup({ onshapeMaterial: "Carbon Fiber", shape: { kind: "box-tube", d1: 22, d2: 22, wall: 1.3 } })?.changes.material).toBe("Carbon square tube 22×22×1.3mm");
  });

  it("links round tubes by material, OD and wall", () => {
    expect(setup({ onshapeMaterial: "Carbon Fiber", shape: { kind: "round-tube", d1: 25, d2: 25, wall: 1.5 } })?.changes.material).toBe("Carbon Fiber 25x1.5 tube");
    expect(setup({ onshapeMaterial: "Carbon Fiber", shape: { kind: "round-tube", d1: 25, d2: 25, wall: 2 } })?.changes.material).toBe("Carbon Fiber Ø25 tube (other walls)");
    expect(setup({ onshapeMaterial: "Aluminum - 6061", shape: { kind: "round-tube", d1: 25, d2: 25, wall: 1.5 } })?.changes.material).toBe("Aluminum 25x1.5 tube");
  });

  it("turns 4 mm rods and round spacers on the lathe instead of calling them plates", () => {
    const rod = setup({ onshapeMaterial: "Aluminum - 6061", bbox: [4, 4, 60], shape: shapeOf(prism(circle(4, 32), 60)) });
    expect(rod?.changes).toMatchObject({ material: "Aluminum Ø10mm cylinder", process1: "lathe" });
    const spacer = setup({ onshapeMaterial: "Aluminum - 6061", bbox: [6, 20, 20], shape: shapeOf(prism(circle(20, 48), 6, circle(8, 48))) });
    expect(spacer?.changes).toMatchObject({ material: "Aluminum Ø25mm cylinder", process1: "lathe" });
  });

  it("mills other metal parts, and never prints metal", () => {
    const s = setup({ onshapeMaterial: "Aluminum - 6061", shape: { kind: "block", size: [30, 40, 50] } });
    expect(s?.changes).toMatchObject({ process1: "cnc", classification: "inhouse" });
    expect(s?.changes.material).toBeUndefined();
    const p = setup({ onshapeMaterial: "Aluminum - 6061", shape: { kind: "plate", t: 4 } });
    expect(p?.changes).toMatchObject({ material: "Aluminum plate 6061 4mm", process1: "cnc" });
  });

  it("leaves COTS parts' hex shafts and rods alone", () => {
    expect(setup({ onshapeMaterial: "Steel", shape: { kind: "hex", d1: 12.7, d2: 14.6 } }, { classification: "cots" })).toBeNull();
  });

  // Harel, 2026-11-06: what the replay on the live robots got wrong.
  it("reads a pocketed plate misread as a thin box tube as a plate", () => {
    const s = setup({ onshapeMaterial: "Aluminum - 6061", shape: { kind: "box-tube", d1: 6.71, d2: 241.5, wall: 1.6, length: 304 } });
    expect(s?.changes).toMatchObject({ material: "Aluminum plate 6061 6.7mm", process1: "cnc" });
  });

  it("cuts a solid part as thick as a stock plate from that plate", () => {
    expect(setup({ onshapeMaterial: "Aluminum - 6061", shape: { kind: "block", size: [6.7, 13.2, 43.8] } })?.changes.material).toBe("Aluminum plate 6061 6.7mm");
    expect(setup({ onshapeMaterial: "Aluminum - 6061", bbox: [6.7, 25, 103.8] })?.changes.material).toBe("Aluminum plate 6061 6.7mm");
  });

  it("knows hex stock and tubes from a bounding box alone", () => {
    expect(setup({ onshapeMaterial: "Aluminum - 6061", bbox: [12.7, 14.67, 721.6] })?.changes).toMatchObject({ material: '1/2" Hex shaft', process1: "manual-mill" });
    const tube = setup({ onshapeMaterial: "Aluminum - 6061", bbox: [25, 50, 600], wallMm: 1.5 });
    expect(tube?.changes.material).toMatch(/25×50×1.5mm|50x25mm 1.5mm wall/);
    expect(tube?.changes.process2 ?? null).toBeNull();
  });

  it("links an old free-text material to its stock item", () => {
    expect(setup({ onshapeMaterial: "Aluminum - 6061" }, { classification: "inhouse", material: "6.7mm 6061-T6" })?.changes.material).toBe("Aluminum plate 6061 6.7mm");
    expect(setup({ onshapeMaterial: "7075 Aluminum" }, { classification: "inhouse", material: "1/2In HEX Shaft" })?.changes.material).toBe('1/2" Hex shaft');
  });

  it("doesn't bend a round block", () => {
    const s = setup({ onshapeMaterial: "Aluminum - 6061", bbox: [20.7, 24.6, 25], wallMm: 2, shape: { kind: "block", size: [20.7, 24.6, 25], axisymmetric: true } });
    expect(s?.changes.process1).toBe("lathe");
    expect(s?.changes.process2 ?? null).toBeNull();
  });

  it("turns brass bushings from the brass cylinder, also when they read as a short tube", () => {
    const bushing = setup({ onshapeMaterial: "Brass", shape: { kind: "round-tube", d1: 13.69, d2: 13.9, wall: 4.8, length: 21.2 } });
    expect(bushing?.changes).toMatchObject({ material: "Brass cylinder", process1: "lathe", classification: "inhouse" });
    expect(setup({ onshapeMaterial: "Brass", shape: { kind: "spacer", d1: 17.7, d2: 40.4, length: 17.7, axisymmetric: true } })?.changes.material).toBe("Brass cylinder");
  });

  it("takes a plate with no Onshape material as aluminum, and a tube as whatever stock fits", () => {
    const s = setup({ shape: { kind: "plate", t: 3, pocketed: true } });
    expect(s?.changes).toMatchObject({ material: "Aluminum plate 6061 3mm", process1: "cnc" });
    expect(s?.reason).toContain("taken as aluminum");
    expect(setup({ shape: { kind: "round-tube", d1: 15.76, d2: 16, wall: 0.94, length: 659 } })?.changes).toMatchObject({ material: "Carbon Fiber 16x1 tube", classification: "inhouse" });
  });

  it("reads hex stock from the name when nothing was measured", () => {
    expect(setup({ onshapeMaterial: "7075 Aluminum" }, { onshapeName: '1/2" Hex (8.087 in)' })?.changes).toMatchObject({ material: '1/2" Hex shaft', process1: "manual-mill" });
  });
});
