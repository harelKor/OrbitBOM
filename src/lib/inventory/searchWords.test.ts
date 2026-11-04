import { describe, expect, it } from "vitest";
import { matchesSearch, searchAlternatives, toEnglishQuery, searchRank } from "./searchWords";

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

describe("toEnglishQuery", () => {
  it("turns Hebrew shop words into English", () => {
    const cases: [string, string][] = [
      ["דבק מהיר סמיך", "ca glue thick"],
      ["אפוקסי 5 דקות", "epoxy 5 minute"],
      ["איזולירבנד", "electrical tape"],
      ["סופיות 16AWG", "ferrule 16awg"],
      ["נעל כבל", "ring terminal"],
      ["אזיקונים", "zip tie"],
      ["מפתח אלן 4", "hex key 4"],
      ["מקדח 4.2", "drill 4.2"],
      ["מברז M5", "tap m5"],
      ["כרסום פלוט אחד", "end mill single flute"],
      ["כבל 12AWG", "wire 12awg"],
    ];
    for (const [he, en] of cases) expect(toEnglishQuery(he)).toBe(en);
  });
  it("leaves English alone and gives up on unknown Hebrew", () => {
    expect(toEnglishQuery("kraken x60")).toBeNull();
    expect(toEnglishQuery("שלום עולם")).toBeNull();
  });
});

describe("matching anywhere in the name", () => {
  it("finds words in the middle or end, ignoring spaces, dashes and dots", () => {
    expect(matchesSearch("Bearing block", "block")).toBe(true);
    expect(matchesSearch("Side plate", "sideplate")).toBe(true);
    expect(matchesSearch("1691-26-501-01A", "26501")).toBe(true);
    expect(matchesSearch("1691-26-501-01A", "501 01a")).toBe(true);
    expect(matchesSearch("Side plate", "side pl")).toBe(true);
    expect(matchesSearch("Side plate", "gusset")).toBe(false);
  });

  it("ranks a name that starts with the query first", () => {
    expect(searchRank("Spacer 10mm", "spa")).toBe(3);
    expect(searchRank("Shaft spacer", "spa")).toBe(2);
    expect(searchRank("Hexspacer", "spa")).toBe(1);
    expect(searchRank("Shaft", "spa")).toBe(0);
  });
});
