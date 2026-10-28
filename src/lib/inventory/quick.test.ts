import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import type { InvCategory } from "./categories";
import { buildName } from "./categories";
import { parseQuick } from "./quick";

const cats: InvCategory[] = DEFAULT_CATEGORIES.map((c) => ({ id: c.id, label: c.label, noun: c.noun, group: c.group, sheet: !!c.sheet, image: null, defaultLocationId: null, fields: c.fields }));
const pulleys = cats.find((c) => c.id === "pulleys")!;

describe("parseQuick", () => {
  it("reads a pulley from plain typing", () => {
    expect(parseQuick("36t htd 1/2 hex pulley", cats)).toEqual({ categoryId: "pulleys", specs: { teeth: "36", pitch: "HTD 5mm", bore: '1/2" Hex' }, left: [] });
  });
  it("reads widths, inch marks and fractions", () => {
    expect(parseQuick('24T GT2 9mm wide ½" hex pulley', cats)?.specs).toEqual({ teeth: "24", pitch: "GT2 3mm", width: "9", bore: '1/2" Hex' });
  });
  it("doesn't take a size that several options share as a part match", () => {
    expect(parseQuick("pulley 5mm bore", cats)?.specs).toEqual({ bore: "5mm" });
  });
  it("picks BOM materials and lengths", () => {
    expect(parseQuick("3mm 6061 plate", cats)).toEqual({ categoryId: "aluminum-plates", specs: { material: "3mm 6061-T6" }, left: [] });
    expect(parseQuick("1/2 hex shaft 300mm", cats)).toEqual({ categoryId: "shafts", specs: { profile: '1/2" Hex', length: "300" }, left: [] });
  });
  it("keeps the words it couldn't place", () => {
    expect(parseQuick("36t htd pulley blue anodized", cats)?.left).toEqual(["blue", "anodized"]);
  });
  it("knows nothing without a category", () => {
    expect(parseQuick("blue thing", cats)).toBeNull();
  });
});

describe("parseQuick with sub-types", () => {
  const read = (text: string) => parseQuick(text, cats);
  it("reads glues, Loctite and tapes", () => {
    expect(read("5 min epoxy")).toEqual({ categoryId: "adhesives-tapes", specs: { type: "Glue", glue: "Epoxy", cure: "5 Min" }, left: [] });
    expect(read("Loctite 243")).toEqual({ categoryId: "adhesives-tapes", specs: { type: "Loctite", grade: "Blue (Medium)" }, left: [] });
    expect(read("duct tape 48mm")?.specs).toEqual({ type: "Tape", tape: "Duct Tape", width: "48" });
  });
  it("reads tools", () => {
    expect(read("Allen 4mm")).toEqual({ categoryId: "hand-tools", specs: { type: "Allen Key", size: "4mm" }, left: [] });
    expect(read("M5 tap")).toEqual({ categoryId: "drills-taps", specs: { type: "Tap", thread: "M5" }, left: [] });
    expect(read("drill bit 4.2mm")?.specs).toEqual({ type: "Drill Bit", size: "4.2" });
  });
  it("reads rivets, screws and wiring", () => {
    expect(read("rivet 5x12")).toEqual({ categoryId: "rivets", specs: { diameter: '5mm (3/16")', length: "12" }, left: [] });
    expect(read("M5x15 button screw")?.specs).toEqual({ kind: "Button Head (כיפה)", thread: "M5", length: "15" });
    expect(read("12 AWG ferrule")?.specs).toEqual({ type: "Ferrule (סופית)", awg: "12 AWG" });
    expect(read("40A breaker")?.specs).toEqual({ type: "Fuse / Snap Breaker", rating: "40A" });
    expect(read("zip tie small")?.specs).toEqual({ type: "Zip Tie", size: "Small" });
  });
});

describe("buildName", () => {
  it("puts the sub-type last and doesn't repeat it", () => {
    const get = (id: string) => cats.find((c) => c.id === id)!;
    expect(buildName(get("drills-taps"), { type: "Tap", thread: "M5" })).toBe("M5 Tap");
    expect(buildName(get("wiring"), { type: "Ferrule (סופית)", awg: "12 AWG", series: "Wago" })).toBe("12 AWG Ferrule");
    expect(buildName(get("adhesives-tapes"), { type: "Tape", tape: "Duct Tape", width: "48" })).toBe("Duct Tape 48mm");
  });

  it("builds the item name from the values", () => {
    expect(buildName(pulleys, { teeth: "36", pitch: "HTD 5mm", width: "9", bore: '1/2" Hex' })).toBe('36T HTD 5mm 9mm wide 1/2" Hex Pulley');
    expect(buildName(pulleys, {})).toBe("");
  });
});
