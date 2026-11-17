import { describe, expect, it } from "vitest";
import { FIND_MS, findCam, fullPlan, zoneFit } from "./camera";

const aspect = 10 / 16;
const zone = { id: "z", name: "Zone", outline: [[300, 290], [400, 290], [400, 325], [300, 325]] as [number, number][], imageUrl: "/x.webp", imageW: 1600, imageH: 1000 };
const spot = { id: "s", name: "Drawer", parentId: "z", spotX: 0.3, spotY: 0.6 };

describe("findCam", () => {
  it("starts on the whole map and stays on the top view until the pause ends", () => {
    expect(findCam(0, zone, spot, aspect).plan.w).toBeCloseTo(fullPlan(aspect).w);
    const atPause = findCam(1100, zone, spot, aspect);
    expect(atPause.dive).toBe(0);
    // Wider than the zone's own view: its surroundings are still in sight.
    expect(atPause.plan.w).toBeGreaterThan(zoneFit(zone, aspect)!.w * 2);
  });
  it("dives after the pause and ends on the drawer", () => {
    expect(findCam(1600, zone, spot, aspect).dive).toBeGreaterThan(0.3);
    const end = findCam(FIND_MS, zone, spot, aspect);
    expect(end.dive).toBe(1);
    expect(end.scene.cx).toBeCloseTo(0.3);
    expect(end.scene.s).toBeGreaterThan(2);
  });
  it("glides on in to a zone without a picture", () => {
    const plain = { ...zone, imageUrl: null };
    expect(findCam(FIND_MS, plain, null, aspect).plan.w).toBeLessThan(zoneFit(plain, aspect)!.w * 1.05);
  });
});
