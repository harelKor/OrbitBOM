import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import type { InvCategory } from "./categories";
import { buildName } from "./categories";
import { parseQuick } from "./quick";

const cats: InvCategory[] = DEFAULT_CATEGORIES.map((c) => ({ id: c.id, label: c.label, noun: c.noun, sheet: !!c.sheet, image: null, defaultLocationId: null, fields: c.fields }));
const pulleys = cats.find((c) => c.id === "pulleys")!;

describe("parseQuick", () => {
  it("reads a pulley from plain typing", () => {
    expect(parseQuick("36t htd 1/2 hex pulley", cats)).toEqual({ categoryId: "pulleys", specs: { teeth: "36", pitch: "HTD 5mm", bore: '1/2" Hex' } });
  });
  it("reads widths, inch marks and fractions", () => {
    expect(parseQuick('24T GT2 9mm wide ½" hex pulley', cats)?.specs).toEqual({ teeth: "24", pitch: "GT2 3mm", width: "9", bore: '1/2" Hex' });
  });
  it("doesn't take a size that several options share as a part match", () => {
    expect(parseQuick("pulley 5mm bore", cats)?.specs).toEqual({ bore: "5mm" });
  });
  it("picks BOM materials and lengths", () => {
    expect(parseQuick("3mm 6061 plate", cats)).toEqual({ categoryId: "aluminum-plates", specs: { material: "3mm 6061-T6" } });
    expect(parseQuick("1/2 hex shaft 300mm", cats)).toEqual({ categoryId: "shafts", specs: { profile: '1/2" Hex', length: "300" } });
  });
  it("knows nothing without a category", () => {
    expect(parseQuick("blue thing", cats)).toBeNull();
  });
});

describe("buildName", () => {
  it("builds the item name from the values", () => {
    expect(buildName(pulleys, { teeth: "36", pitch: "HTD 5mm", width: "9", bore: '1/2" Hex' })).toBe('36T HTD 5mm 9mm wide 1/2" Hex Pulley');
    expect(buildName(pulleys, {})).toBe("");
  });
});
