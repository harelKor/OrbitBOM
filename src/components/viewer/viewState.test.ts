import { describe, expect, it } from "vitest";
import { cleanView, decodeView, encodeView, hashWithView, viewFromHash, type ViewState } from "./viewState";

const view: ViewState = {
  pose: { target: [0.123456789, 0, -1], dir: [0.57735, 0.57735, 0.57735], half: 0.8, projection: "perspective" },
  vis: { hidden: [{ key: "a:b:P1", at: [0.001, 0.002, 0.003] }], isolated: ["a:b:P2"], ghost: 0.5, clear: [] },
  section: { planes: [{ from: "face", normal: [0, 0, 1], origin: [0, 0, 0], offset: 5, tilt: [10, 0], flip: false }], open: false },
  display: "hiddenVisible",
  colors: "compare",
};

describe("viewState", () => {
  it("round-trips through the URL, rounded to 0.01 mm", () => {
    const back = decodeView(encodeView(view))!;
    expect(back.pose.target).toEqual([0.12346, 0, -1]);
    expect(back.pose.projection).toBe("perspective");
    expect(back.vis).toEqual(view.vis);
    expect(back.section).toEqual(view.section);
    expect(back.display).toBe("hiddenVisible");
    expect(back.colors).toBe("compare");
    expect(encodeView(view)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("keeps the hash's other parts", () => {
    const h = hashWithView(view, "#tab=2&v=old");
    expect(h.startsWith("#tab=2&v=")).toBe(true);
    expect(viewFromHash(h)?.pose.half).toBe(0.8);
    expect(hashWithView(null, h)).toBe("#tab=2");
  });

  it("drops what isn't a view", () => {
    expect(cleanView(null)).toBeNull();
    expect(cleanView({ pose: { target: [0, 0], dir: [0, 0, 1], half: 1 } })).toBeNull();
    expect(cleanView({ pose: { target: [0, 0, 0], dir: [0, 0, 1], half: -1 } })).toBeNull();
    expect(decodeView("!!!")).toBeNull();
    const v = cleanView({ ...view, display: "wild", section: { planes: [{ origin: { x: 1 } }] }, extra: 1 })!;
    expect(v.display).toBeUndefined();
    expect(v.section).toBeUndefined();
    expect("extra" in v).toBe(false);
  });
});
