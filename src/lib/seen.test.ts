import { describe, expect, it } from "vitest";
import type { StatusInput } from "./status";
import { arrivalPage, arrives, isNewSince } from "./seen";

const part: StatusInput = {
  classification: "inhouse",
  quantity: 1,
  designState: "Not Started",
  preProcess: null,
  process1: "laser",
  process2: null,
  donePreprocess: 0,
  doneProcess1: 0,
  doneProcess2: 0,
};
const at = (designState: string, more: Partial<StatusInput> = {}) => ({ ...part, designState, ...more });

describe("arrivals", () => {
  it("lists a part on the page its status puts it", () => {
    expect(arrivalPage(at("Released"), "r1")).toEqual({ page: "fab:r1", machine: "laser" });
    expect(arrivalPage(at("Post Processing"), "r1")?.page).toBe("fab:r1");
    expect(arrivalPage(at("Ready for QA"), "r1")).toBeNull();
    expect(arrivalPage(at("Released", { process1: "3d-bambu" }), "r1")?.page).toBe("print:r1:3d-bambu");
    expect(arrivalPage(at("Released", { process1: "zivudim" }), "r1")?.page).toBe("factory:r1:zivudim");
    expect(arrivalPage(at("In Order List", { classification: "cots", process1: null }), null)?.page).toBe("cots:order");
  });

  it("arrives on moving into Released, In process or Post Processing, and back to Released", () => {
    expect(arrives(at("Not Started"), at("Released"))).toBe(true);
    expect(arrives(at("Released"), at("In Process 1"))).toBe(true);
    expect(arrives(at("In Process 1"), at("Post Processing"))).toBe(true);
    expect(arrives(at("Reproduction"), at("Released"))).toBe(true);
    expect(arrives(at("Post Processing"), at("Ready for QA"))).toBe(false);
    expect(arrives(at("Released"), at("Released", { note: "x" } as Partial<StatusInput>))).toBe(false);
    // Same status on another page (laser → Bambu) arrives there.
    expect(arrives(at("Released"), at("Released", { process1: "3d-bambu" }))).toBe(true);
  });

  it("counts from the member's first visit", () => {
    expect(isNewSince("2026-11-05T10:00:00Z", null)).toBe(false);
    expect(isNewSince("2026-11-05T10:00:00Z", "2026-11-05T09:00:00Z")).toBe(true);
    expect(isNewSince("2026-11-05T08:00:00Z", "2026-11-05T09:00:00Z")).toBe(false);
  });
});
