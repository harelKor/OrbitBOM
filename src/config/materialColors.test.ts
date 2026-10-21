import { describe, expect, it } from "vitest";
import { NO_MATERIAL, OTHER_MATERIAL, materialColorGroup } from "./materialColors";

describe("materialColorGroup", () => {
  it("uses the BOM material's category", () => {
    expect(materialColorGroup("3mm 6061-T6", "PLA")).toBe("Aluminum Plates");
    expect(materialColorGroup("Steel")).toBe("3D Printed");
  });
  it("falls back to Onshape's material", () => {
    expect(materialColorGroup(null, "Aluminum - 6061")).toBe("Aluminum Plates");
    expect(materialColorGroup("", "PLA")).toBe("3D Printed");
    expect(materialColorGroup("Mystery", "Polycarbonate")).toBe("Polycarbonate Plates");
    expect(materialColorGroup(null, "Steel - 1018")).toBe("Lathed Parts");
  });
  it("sorts the rest into Other and No material", () => {
    expect(materialColorGroup(null, "Unobtainium")).toBe(OTHER_MATERIAL);
    expect(materialColorGroup(null, null)).toBe(NO_MATERIAL);
  });
});
