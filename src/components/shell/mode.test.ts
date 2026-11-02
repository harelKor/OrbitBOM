import { describe, expect, it } from "vitest";
import { can, isSpecReset, partChangesCapability, pickableStatuses, RESET_SPECS, statusDenied } from "./mode";

describe("status rules by team", () => {
  it("lets Edit set anything", () => {
    expect(statusDenied("edit", "In Stock", { cots: false })).toBeNull();
    expect(pickableStatuses("edit")).toBeNull();
  });

  it("lets CAD release, and send to Reproduction or Secondary Production only with a note", () => {
    expect(statusDenied("cad", "Released", { cots: false })).toBeNull();
    expect(statusDenied("cad", "Reproduction", { cots: false })).not.toBeNull();
    expect(statusDenied("cad", "Reproduction", { cots: false, note: "  " })).not.toBeNull();
    expect(statusDenied("cad", "Secondary Production", { cots: false, note: "bore oversize" })).toBeNull();
    expect(statusDenied("cad", "In Process 1", { cots: false, note: "x" })).not.toBeNull();
    // The Ready for QA check-off.
    expect(statusDenied("cad", "In Stock", { cots: false })).toBeNull();
    // A COTS part goes back on the Order List instead.
    expect(statusDenied("cad", "In Order List", { cots: true, note: "lost one" })).toBeNull();
    expect(statusDenied("cad", "In Stock", { cots: true, note: "x" })).not.toBeNull();
  });

  it("keeps Build to the shop statuses", () => {
    for (const s of ["Released", "In Process 1", "Ready for Process 2", "Post Processing", "Ready for QA"]) {
      expect(statusDenied("build", s, { cots: false })).toBeNull();
    }
    expect(statusDenied("build", "In Stock", { cots: false })).not.toBeNull();
    expect(statusDenied("build", "Reproduction", { cots: false, note: "x" })).not.toBeNull();
    expect(statusDenied("build", "In Stock", { cots: true })).toBeNull();
  });

  it("lets no team change nothing", () => {
    expect(statusDenied("none", "Released", { cots: false })).not.toBeNull();
  });
});

describe("part type", () => {
  it("lets admins and the CAD Team switch COTS and In-House", () => {
    expect(partChangesCapability({ classification: "cots" })).toBe("classify");
    expect(partChangesCapability({ classification: "inhouse", material: "PLA" })).toBe("classify");
    expect(partChangesCapability({ classification: "undefined" })).toBe("classify");
    expect(partChangesCapability({ classification: "external" })).toBe("manage");
    expect(can("cad", "classify")).toBe(true);
    expect(can("edit", "classify")).toBe(true);
    expect(can("build", "classify")).toBe(false);
  });
});

describe("part window reset (✕)", () => {
  it("is a classify change the CAD Team may make, Not Started included", () => {
    expect(partChangesCapability(RESET_SPECS)).toBe("classify");
    expect(can("cad", "classify")).toBe(true);
    expect(isSpecReset(RESET_SPECS)).toBe(true);
    expect(statusDenied("cad", "Not Started", { cots: false, reset: true })).toBeNull();
    expect(statusDenied("cad", "Not Started", { cots: true, reset: true })).toBeNull();
  });
  it("doesn't open Not Started to the CAD Team otherwise", () => {
    expect(isSpecReset({ status: "Not Started" })).toBe(false);
    expect(isSpecReset({ ...RESET_SPECS, displayName: "x" })).toBe(false);
    expect(statusDenied("cad", "Not Started", { cots: false })).not.toBeNull();
    expect(statusDenied("build", "Not Started", { cots: false, reset: true })).not.toBeNull();
  });
});
