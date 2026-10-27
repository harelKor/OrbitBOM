import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import type { InvCategory } from "./categories";
import { LINK_THRESHOLD, bestLinks, scoreLink, type LinkItem, type LinkPart } from "./linkScore";

const cats: InvCategory[] = DEFAULT_CATEGORIES.map((c) => ({ id: c.id, label: c.label, noun: c.noun, group: c.group, sheet: !!c.sheet, image: null, defaultLocationId: null, fields: c.fields }));
const cat = (id: string) => cats.find((c) => c.id === id);

const part = (over: Partial<LinkPart>): LinkPart => ({ id: "p", names: [], onshapeKey: null, docKey: null, urls: [], thumbHash: null, ...over });
const item = (over: Partial<LinkItem>): LinkItem => ({ id: "i", name: "", aliases: [], category: undefined, specs: {}, urls: [], onshapeKey: null, docKeys: [], thumbHashes: [], ...over });

const pulley36 = item({ id: "p36", name: '36T HTD 5mm 9mm wide 1/2" Hex Pulley', category: cat("pulleys"), specs: { teeth: "36", pitch: "HTD 5mm", width: "9", bore: '1/2" Hex' } });
const pulley24 = item({ id: "p24", name: '24T HTD 5mm 9mm wide 1/2" Hex Pulley', category: cat("pulleys"), specs: { teeth: "24", pitch: "HTD 5mm", width: "9", bore: '1/2" Hex' } });

describe("scoreLink", () => {
  it("is certain for the same Onshape part or product link", () => {
    expect(scoreLink(part({ onshapeKey: "d:e:p" }), item({ onshapeKey: "d:e:p" })).score).toBe(100);
    expect(scoreLink(part({ urls: ["https://www.wcproducts.com/x/"] }), item({ urls: ["https://wcproducts.com/x"] })).score).toBe(100);
  });
  it("links a half set-up part by the sizes and words in its name", () => {
    const s = scoreLink(part({ names: ["36t htd pulley 1/2 hex"] }), pulley36);
    expect(s.score).toBeGreaterThanOrEqual(LINK_THRESHOLD);
    expect(s.why.join(" ")).toContain("36");
  });
  it("rules out a size that disagrees", () => {
    expect(scoreLink(part({ names: ["36t htd pulley 1/2 hex"] }), pulley24).score).toBe(0);
  });
  it("links a part with the same picture as one already linked", () => {
    const s = scoreLink(part({ names: ["Part 7"], thumbHash: "f0f0f0f0f0f0f0f0" }), item({ name: "Kraken X60", thumbHashes: [{ hash: "f0f0f0f0f0f0f0f1", partName: "Kraken" }] }));
    expect(s.score).toBeGreaterThanOrEqual(LINK_THRESHOLD);
    expect(s.why[0]).toContain("same picture as Kraken");
  });
  it("doesn't link on one shared word", () => {
    expect(scoreLink(part({ names: ["Side plate"] }), item({ name: "Plate clamp bearing" })).score).toBeLessThan(LINK_THRESHOLD);
  });
});

describe("bestLinks", () => {
  it("picks the best item and skips rejected pairs and near ties", () => {
    const p = part({ id: "a", names: ["36T HTD 5mm Pulley"] });
    expect(bestLinks([p], [pulley36, pulley24]).map((l) => l.itemId)).toEqual(["p36"]);
    expect(bestLinks([p], [pulley36], (_, i) => i === "p36")).toEqual([]);
    const twin = { ...pulley36, id: "twin" };
    expect(bestLinks([p], [pulley36, twin])).toEqual([]);
  });
});
