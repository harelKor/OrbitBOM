import { describe, expect, it } from "vitest";
import { onshapeName, versionLabel } from "./label";

describe("version label", () => {
  it("names a version after its main document only", () => {
    const ref = {
      mv: null,
      did: "asm",
      sources: { cots: { versionId: "a", name: "V3", parts: 2, main: false }, sub: { versionId: "b", name: "V82", parts: 40, main: true }, lib: { versionId: "c", name: "Adding smart names", parts: 5, main: false } },
    };
    expect(versionLabel({ seq: 4, onshapeRef: ref })).toBe("V82");
  });
  it("has no Onshape name when the main document is a workspace", () => {
    const ref = { mv: null, did: "asm", sources: { cots: { versionId: "a", name: "V3", parts: 2, main: false } } };
    expect(versionLabel({ seq: 4, onshapeRef: ref })).toBe("#4");
  });
  it("takes the system's own document in versions read before the mark", () => {
    const ref = { mv: null, did: "asm", sources: { cots: { versionId: "a", name: "V3" }, asm: { versionId: "b", name: "V70" } } };
    expect(onshapeName(ref)).toBe("V70");
    expect(onshapeName({ mv: null, did: "x", sources: { cots: { versionId: "a", name: "V3" }, lib: { versionId: "b", name: "V9" } } })).toBe("V3");
  });
});
