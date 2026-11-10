import { describe, expect, it } from "vitest";
import { parsePlace, placeKey, subCodeOf, subColor } from "./groups";

describe("subCodeOf", () => {
  it("reads system + sub-assembly 1 from the part number", () => {
    expect(subCodeOf("1690-26-421-01")).toBe("42");
    expect(subCodeOf("1690-26-428-13A")).toBe("42");
    expect(subCodeOf("1691-26-431-05")).toBe("43");
  });
  it("ignores sub-assembly 2", () => {
    expect(subCodeOf("1690-26-421-01")).toBe(subCodeOf("1690-26-425-02"));
  });
  it("treats tens digit 0 as straight in the system", () => {
    expect(subCodeOf("1690-26-401-03")).toBeNull();
    expect(subCodeOf("1690-26-400-01")).toBeNull();
  });
  it("finds the code inside a name, falling back to later names", () => {
    expect(subCodeOf(null, "Side plate 1690-26-412-02")).toBe("41");
    expect(subCodeOf("Side plate", "1690-26-412-02")).toBe("41");
  });
  it("returns null for parts with no code", () => {
    expect(subCodeOf("#10-32 x 0.5 SHCS", null)).toBeNull();
    expect(subCodeOf(undefined)).toBeNull();
  });
});

describe("subColor", () => {
  it("is stable and differs between neighbours", () => {
    expect(subColor("42")).toBe(subColor("42"));
    expect(subColor("42")).not.toBe(subColor("43"));
    expect(subColor("42")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("places", () => {
  const id = "0b5c2a4e-1111-4222-8333-944455556666";
  it("round-trips through the address", () => {
    expect(parsePlace(placeKey({ systemId: id, sub: "42" }))).toEqual({ systemId: id, sub: "42" });
    expect(parsePlace(id)).toEqual({ systemId: id, sub: null });
    expect(parsePlace("nope")).toBeNull();
    expect(parsePlace(null)).toBeNull();
  });
});
