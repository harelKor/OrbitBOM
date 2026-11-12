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
    const r = cleanAnswer(answer({ categoryId: "pulleys", specs: [{ field: "pitch", value: "htd 5MM" }, { field: "colour", value: "red" }, { field: "width", value: "9 mm" }], textSeen: "HTD 5MM 9mm" }), cats);
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

  it("keeps a gear's DP and bore only when printed on it, and a printed count beats the phone's", () => {
    const guess = answer({ categoryId: "gears", brand: "WCP", product: "36T 20DP Gear", specs: [{ field: "dp", value: "20 DP" }, { field: "bore", value: '1/2" Hex' }] });
    const r = cleanAnswer(guess, cats, { teeth: 36 });
    expect(r.specs).toEqual({ teeth: "36" });
    expect(r.name).toBe("");
    expect(r.searchQuery).toBeNull();
    expect(r.toothed).toBe(true);
    const marked = cleanAnswer({ ...guess, textSeen: "WCP 42T 20 DP 1/2 HEX" }, cats, { teeth: 40 });
    expect(marked.specs).toEqual({ teeth: "42", dp: "20 DP", bore: '1/2" Hex' });
  });

  it("names a known product with its brand once, and searches for it", () => {
    const r = cleanAnswer(answer({ categoryId: "motors", brand: "WCP", product: "Kraken X60" }), cats);
    expect(r.name).toBe("WCP Kraken X60");
    expect(r.searchQuery).toBe("WCP Kraken X60");
    expect(cleanAnswer(answer({ categoryId: "motors", brand: "REV", product: "REV NEO Vortex" }), cats).name).toBe("REV NEO Vortex");
  });
});
