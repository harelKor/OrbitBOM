import { describe, expect, it } from "vitest";
import { combineCounts, countTeeth, countTeethInRing, type TeethResult } from "./teeth";

// A drawn part on a plain background: toothed outline (square-ish teeth with sloped sides), a hex
// or round bore, optional squash (photo not quite from above), light noise.
function drawPart(o: { teeth: number; size?: number; radius?: number; depth?: number; bore?: "hex" | "round" | null; squash?: number; dark?: boolean; noise?: number; cx?: number; cy?: number; light?: number; clutter?: boolean }) {
  const size = o.size ?? 360;
  const R = o.radius ?? size * 0.36;
  const depth = o.depth ?? R * 0.07;
  const cx = o.cx ?? size / 2;
  const cy = o.cy ?? size / 2;
  const squash = o.squash ?? 1;
  const bg = o.dark ? 30 : 225;
  const fg = o.dark ? 200 : 50;
  const gray = new Uint8Array(size * size);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * (o.noise ?? 20);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = (y - cy) / squash;
      const r = Math.hypot(dx, dy);
      const th = Math.atan2(dy, dx);
      const phase = (((th / (2 * Math.PI)) * o.teeth) % 1 + 1) % 1;
      const tooth = Math.max(0, Math.min(1, (0.5 - Math.abs(phase - 0.5)) * 6 - 0.5)); // trapezoid
      const outer = R - depth + 2 * depth * tooth;
      let inside = r <= outer;
      const hole = R * 0.18;
      if (o.bore === "round" && r < hole) inside = false;
      if (o.bore === "hex") {
        // A hexagon: the distance to its flat sides.
        const a = (((th % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) - Math.PI / 6;
        if (r * Math.cos(a) < hole) inside = false;
      }
      // A lamp on one side: brightness slides across the picture.
      const lamp = ((x / size) - 0.5) * (o.light ?? 0);
      // A busy bench: a few dark tools well away from the part.
      const tool = o.clutter && ((x < size * 0.12 && y > size * 0.2 && y < size * 0.5) || (y > size * 0.9 && x > size * 0.6));
      gray[y * size + x] = Math.max(0, Math.min(255, (inside || tool ? fg : bg) + lamp + rand()));
    }
  return { gray, size };
}

describe("countTeeth", () => {
  for (const teeth of [12, 18, 24, 36, 48, 60, 72]) {
    it(`counts a ${teeth} tooth gear`, () => {
      const { gray, size } = drawPart({ teeth, bore: "hex" });
      const r = countTeeth(gray, size, size)!;
      expect(r.teeth).toBe(teeth);
      expect(r.confidence).toBeGreaterThan(0.5);
    });
  }

  it("tells a hex bore from a round one", () => {
    const hex = drawPart({ teeth: 36, bore: "hex" });
    const round = drawPart({ teeth: 36, bore: "round" });
    expect(countTeeth(hex.gray, hex.size, hex.size)!.bore).toBe("hex");
    expect(countTeeth(round.gray, round.size, round.size)!.bore).toBe("round");
    const solid = drawPart({ teeth: 36, bore: null });
    expect(countTeeth(solid.gray, solid.size, solid.size)!.bore).toBeNull();
  });

  it("copes with a light part on a dark bench, off centre, a bit from the side", () => {
    const { gray, size } = drawPart({ teeth: 40, dark: true, cx: 160, cy: 200, radius: 110, squash: 0.88, noise: 40 });
    expect(countTeeth(gray, size, size)!.teeth).toBe(40);
    const tilted = drawPart({ teeth: 56, squash: 0.7, bore: "hex" });
    expect(countTeeth(tilted.gray, tilted.size, tilted.size)!.teeth).toBe(56);
  });

  it("copes with a lamp on one side and tools on the bench", () => {
    const { gray, size } = drawPart({ teeth: 36, bore: "hex", light: 120, clutter: true, radius: 120, noise: 30 });
    expect(countTeeth(gray, size, size)!.teeth).toBe(36);
  });

  it("counts a small gear with many teeth", () => {
    const { gray, size } = drawPart({ teeth: 64, size: 480, radius: 70, depth: 4 });
    expect(countTeeth(gray, size, size)!.teeth).toBe(64);
  });

  it("finds no teeth on a plain disc", () => {
    const { gray, size } = drawPart({ teeth: 30, depth: 0 });
    const r = countTeeth(gray, size, size)!;
    expect(r.teeth).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it("gives up on an empty picture", () => {
    expect(countTeeth(new Uint8Array(100 * 100).fill(128), 100, 100)).toBeNull();
  });
});

// Harel's video (2026-11-12): a tan gear on a light grey bench, the phone's dark shadow over one
// corner, the gear a bit off the middle of the aim ring. Brightness alone took the shadow for the
// part and read "8" on every frame.
function tanGearOnBench(teeth: number, o: { size?: number; shadow?: boolean; seed?: number } = {}) {
  const size = o.size ?? 320;
  const R = size * 0.3;
  const depth = R * 0.08;
  const cx = size * 0.53;
  const cy = size * 0.48;
  const rgba = new Uint8Array(size * size * 4);
  let seed = o.seed ?? 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 16;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      const th = Math.atan2(dy, dx);
      const phase = ((((th / (2 * Math.PI)) * teeth) % 1) + 1) % 1;
      const tooth = Math.max(0, Math.min(1, (0.5 - Math.abs(phase - 0.5)) * 6 - 0.5));
      const inside = r <= R - depth + 2 * depth * tooth && r > R * 0.2;
      // A soft dark shadow from the lower left, over bench and gear alike.
      const shade = o.shadow === false ? 1 : 1 - 0.55 * Math.max(0, Math.min(1, 1.4 - Math.hypot(x / size, 1 - y / size) * 2));
      const [cr, cg, cb] = inside ? [205, 185, 140] : [178, 178, 182];
      const i = (y * size + x) * 4;
      const n = rand();
      rgba[i] = Math.max(0, Math.min(255, cr * shade + n));
      rgba[i + 1] = Math.max(0, Math.min(255, cg * shade + n));
      rgba[i + 2] = Math.max(0, Math.min(255, cb * shade + n));
      rgba[i + 3] = 255;
    }
  return { rgba, size };
}

describe("countTeethInRing", () => {
  it("counts a tan gear on a grey bench under the phone's shadow", () => {
    for (const teeth of [24, 30, 36]) {
      const { rgba, size } = tanGearOnBench(teeth);
      expect(countTeethInRing(rgba, size)?.teeth).toBe(teeth);
    }
  });

  it("is needed: brightness alone misreads that picture", () => {
    const { rgba, size } = tanGearOnBench(30);
    const gray = new Uint8Array(size * size).map((_, p) => (rgba[p * 4] * 77 + rgba[p * 4 + 1] * 150 + rgba[p * 4 + 2] * 29) >> 8);
    expect(countTeeth(gray, size, size)?.teeth).not.toBe(30);
  });

  it("finds nothing on an empty bench", () => {
    const { rgba, size } = tanGearOnBench(30);
    const bench = Uint8Array.from(rgba, (v, i) => (i % 4 === 3 ? 255 : 178));
    expect(countTeethInRing(bench, size)?.teeth ?? null).toBeNull();
  });
});

describe("combineCounts", () => {
  const frame = (best: number, also: Record<number, number> = {}): TeethResult => {
    const scores = Array.from({ length: 120 }, (_, k) => (k === best ? 1 : (also[k] ?? 0.2)));
    return { teeth: best, confidence: 0.6, bore: null, center: { x: 0, y: 0 }, radius: 50, candidates: [], scores };
  };

  it("settles a ±1 wobble on the count most frames back", () => {
    expect(combineCounts([frame(30, { 31: 0.7 }), frame(31, { 30: 0.8 }), frame(30, { 31: 0.6 }), frame(30)]).teeth).toBe(30);
  });

  it("waits for enough frames, and for them to agree", () => {
    expect(combineCounts([frame(30), frame(30)]).teeth).toBeNull();
    expect(combineCounts([frame(30), frame(45), frame(60), frame(80)]).teeth).toBeNull();
  });
});
