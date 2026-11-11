import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import type { InvCategory } from "@/lib/inventory/categories";
import { catalogText, cleanAnswer, type ModelAnswer } from "./answer";

const cats: InvCategory[] = DEFAULT_CATEGORIES.map((c) => ({ id: c.id, label: c.label, noun: c.noun, group: c.group, sheet: !!c.sheet, image: null, defaultLocationId: null, fields: c.fields }));
const answer = (over: Partial<ModelAnswer>): ModelAnswer => ({ categoryId: "", specs: [], brand: "", product: "", partNumber: "", searchQuery: "", textSeen: "", confidence: 0.8, alternatives: [], ...over });

describe("catalogText", () => {
  it("lists our ids and option spellings", () => {
    const text = catalogText(cats);
    expect(text).toContain("pulleys: Pulleys");
    expect(text).toContain("HTD 5mm");
  });
});

describe("cleanAnswer", () => {
  it("keeps only our category, fields and option spellings", () => {
    const r = cleanAnswer(answer({ categoryId: "pulleys", specs: [{ field: "pitch", value: "htd 5MM" }, { field: "colour", value: "red" }, { field: "width", value: "9 mm" }] }), cats);
    expect(r.categoryId).toBe("pulleys");
    expect(r.specs).toEqual({ pitch: "HTD 5mm", width: "9" });
  });

  it("drops an unknown category", () => {
    expect(cleanAnswer(answer({ categoryId: "spaceships" }), cats).categoryId).toBeNull();
  });

  it("trusts the phone's tooth count, and drops a tooth count the model only guessed", () => {
    const guessed = answer({ categoryId: "gears", specs: [{ field: "teeth", value: "40" }] });
    expect(cleanAnswer(guessed, cats).specs.teeth).toBeUndefined();
    expect(cleanAnswer(guessed, cats, { teeth: 42 }).specs.teeth).toBe("42");
    expect(cleanAnswer(answer({ categoryId: "gears", specs: [{ field: "teeth", value: "40" }], textSeen: "WCP 40T 20DP" }), cats).specs.teeth).toBe("40");
  });

  it("names a known product with its brand once, and searches for it", () => {
    const r = cleanAnswer(answer({ categoryId: "motors", brand: "WCP", product: "Kraken X60" }), cats);
    expect(r.name).toBe("WCP Kraken X60");
    expect(r.searchQuery).toBe("WCP Kraken X60");
    expect(cleanAnswer(answer({ categoryId: "motors", brand: "REV", product: "REV NEO Vortex" }), cats).name).toBe("REV NEO Vortex");
  });
});
