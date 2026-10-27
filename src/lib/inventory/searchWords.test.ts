import { describe, expect, it } from "vitest";
import { matchesSearch, searchAlternatives } from "./searchWords";

describe("matchesSearch", () => {
  it("finds English names from Hebrew words and back", () => {
    expect(matchesSearch("Bearing 8×16×5mm", "מיסב")).toBe(true);
    expect(matchesSearch("20DP 18T 1/2\" Hex Gear", "גג\"ש 18t")).toBe(true);
    expect(matchesSearch("Polycarbonate 3mm", "פולי")).toBe(true);
    expect(matchesSearch("HTD 18T 9mm Pulley", "פולי 18t")).toBe(true);
    expect(matchesSearch("Wood screw 15mm (ברגי עץ)", "screw")).toBe(true);
    expect(matchesSearch("20DP 30T 1/2\" Hex Gear", "גגשים")).toBe(true);
    expect(matchesSearch("Rivet 5×10mm (ניטים)", "rivet 5×10")).toBe(true);
  });
  it("still needs every word", () => {
    expect(matchesSearch("Bearing 8×16×5mm", "מיסב 6×12")).toBe(false);
    expect(matchesSearch("Drill bit 5mm", "מברז")).toBe(false);
  });
  it("keeps the typed word itself", () => {
    expect(searchAlternatives("kraken")).toEqual(["kraken"]);
  });
});
