import { describe, expect, it } from "vitest";
import { derivedFeature, featureName, groupParts } from "./insertPlan";

describe("insert plan", () => {
  it("makes one group per Part Studio and version", () => {
    const g = groupParts([
      { did: "d", eid: "e", partId: "JHD", versionId: "v1" },
      { did: "d", eid: "e", partId: "JKD", versionId: "v1" },
      { did: "d", eid: "e", partId: "JHD", versionId: "v1" },
      { did: "d", eid: "e", partId: "JHD", versionId: "v2" },
    ]);
    expect(g).toEqual([
      { did: "d", eid: "e", versionId: "v1", partIds: ["JHD", "JKD"] },
      { did: "d", eid: "e", versionId: "v2", partIds: ["JHD"] },
    ]);
  });
  it("references the version, never a workspace", () => {
    const f = derivedFeature("OP 400 Final · V12", { did: "d", eid: "e", versionId: "v", microversion: "m", partIds: ["JHD"] });
    expect(f.feature.parameters[0].namespace).toBe("dd::vv::ee::mm");
    expect(featureName("400", "final", "V12")).toBe("OP 400 Final · V12");
  });
});
