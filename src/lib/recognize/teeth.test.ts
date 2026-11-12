import { describe, expect, it } from "vitest";
import { countTeeth } from "./teeth";

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
