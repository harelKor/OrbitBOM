import { describe, expect, it } from "vitest";
import { explodeOffsets } from "./motion";

type V3 = [number, number, number];
const close = (a: V3, b: V3) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 9));

describe("explodeOffsets", () => {
  // Two subsystems either side of the robot's centre, two parts each.
  const items: { g: number; c: V3 }[] = [
    { g: 0, c: [-1.1, 0, 0] },
    { g: 0, c: [-0.9, 0, 0] },
    { g: 1, c: [0.9, 0, 0] },
    { g: 1, c: [1.1, 0, 0] },
  ];

  it("leaves everything in place at 0", () => {
    explodeOffsets(items, 0).forEach((o) => close(o, [0, 0, 0]));
  });

  it("moves the subsystems out from the robot's centre in the slider's first half, as whole blocks", () => {
    const o = explodeOffsets(items, 0.5);
    close(o[0], [-1, 0, 0]);
    close(o[1], [-1, 0, 0]);
    close(o[3], [1, 0, 0]);
  });

  it("then spreads the parts within each subsystem from its own centre", () => {
    const o = explodeOffsets(items, 1);
    close(o[0], [-1 - 0.1 * 1.2, 0, 0]);
    close(o[1], [-1 + 0.1 * 1.2, 0, 0]);
    close(o[2], [1 - 0.1 * 1.2, 0, 0]);
  });

  it("with one subsystem, spreads its parts over the whole slider", () => {
    const one = items.map((x) => ({ ...x, g: 3 }));
    const o = explodeOffsets(one, 0.5);
    close(o[0], [-1.1 * 0.6, 0, 0]);
    close(o[3], [1.1 * 0.6, 0, 0]);
  });

  it("clamps the slider and copes with nothing", () => {
    expect(explodeOffsets([], 1)).toEqual([]);
    close(explodeOffsets(items, 3)[0], explodeOffsets(items, 1)[0]);
  });
});
