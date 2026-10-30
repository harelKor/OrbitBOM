import { describe, expect, it } from "vitest";
import { pickableStatuses, statusDenied } from "./mode";

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
