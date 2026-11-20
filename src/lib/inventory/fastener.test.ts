import { describe, expect, it } from "vitest";
import { fastenerKey, fastenerMatch, itemFastener, parseFastener, partFastener } from "./fastener";

describe("parseFastener", () => {
  it("reads thread, pitch, length and head in English and Hebrew", () => {
    expect(parseFastener("Socket button head screw M5x0.8 x 35")).toEqual({ kind: "screw", thread: "M5", pitch: "0.8", length: "35", head: "button" });
    expect(parseFastener("M5×10 כיפה")).toEqual({ kind: "screw", thread: "M5", pitch: null, length: "10", head: "button" });
    expect(parseFastener("M5×20 גלילי")).toMatchObject({ thread: "M5", length: "20", head: "socket" });
    expect(parseFastener("Hex socket head cap screw M5x0.80 x 10 x 22")).toMatchObject({ thread: "M5", pitch: "0.8", length: "10", head: "socket" });
    expect(parseFastener("Hex socket countersunk head screw M5x0.8 x 10")).toMatchObject({ head: "flat" });
    expect(parseFastener("M5 x 35mm SHCS")).toMatchObject({ thread: "M5", length: "35", head: "socket" });
    expect(parseFastener("M5x35")).toMatchObject({ kind: "screw", thread: "M5", length: "35", head: null });
    expect(parseFastener('#10-32 x 1/2" BHCS')).toMatchObject({ thread: "#10-32", length: '1/2"', head: "button" });
  });
  it("tells nuts and washers from screws, and the pitch from a length", () => {
    expect(parseFastener("washer M5x0.8")).toMatchObject({ kind: "washer", thread: "M5", length: null });
    expect(parseFastener("M5 nylock nut")).toMatchObject({ kind: "nut", thread: "M5" });
  });
  it("leaves other products alone", () => {
    for (const n of ["8mm Aluminum standoff stock", "Kraken X60", "M5 tap", "1/2 hex shaft collar set screw", "18T HTD Pulley", "Part 12", "1690-26-411-01A"]) expect(parseFastener(n)).toBeNull();
  });
});

describe("fastenerMatch", () => {
  const item = (name: string, specs: Record<string, string> = {}) => itemFastener({ name, specs, categoryId: "fasteners" });
  it("refuses the links the audit found", () => {
    expect(fastenerMatch(partFastener(["Socket button head screw M5x0.8 x 35"]), item("M5×10 כיפה")).result).toBe("clash");
    expect(fastenerMatch(partFastener(["M5x6 button head"]), item("M5×10 כיפה")).result).toBe("clash");
    expect(fastenerMatch(partFastener(["M5x5 BHCS"]), item("M5×10 כיפה")).result).toBe("clash");
    expect(fastenerMatch(partFastener(["Hex socket head cap screw M5x0.8 x 35"]), item("M5×20 גלילי")).result).toBe("clash");
  });
  it("needs thread, length and head on both", () => {
    expect(fastenerMatch(partFastener(["M5x35"]), item("M5×35 כיפה")).result).toBe("clash");
    expect(fastenerMatch(partFastener(["Part 3"]), item("M5×35 כיפה")).result).toBe("clash");
    expect(fastenerMatch(partFastener(["M5x35 button head"]), itemFastener({ name: "Pulley", categoryId: "pulleys" })).result).toBe("clash");
    expect(fastenerMatch(partFastener(["Part 3"]), itemFastener({ name: "Pulley", categoryId: "pulleys" })).result).toBe("none");
  });
  it("links the same screw across languages, with the item's specs filling its name", () => {
    expect(fastenerMatch(partFastener(["Socket button head screw M5x0.8 x 35"]), item("M5×35 כיפה"))).toEqual({ result: "match", why: "M5×35 button head match" });
    expect(fastenerMatch(partFastener(["M5x35 SHCS"]), item("M5×35", { kind: "SHCS (רגיל)" })).result).toBe("match");
  });
});

describe("fastenerKey", () => {
  it("writes every notation one way", () => {
    for (const s of ["m5x35", "m5x0.8x35", "m5x0.80 x 35", "m5 x 35mm", "m5-0.8 x 35"]) expect(fastenerKey(s)).toBe("m5x35");
    expect(fastenerKey("washer m5x0.8")).toBe("washer m5x0.8");
  });
});
