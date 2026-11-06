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
    // The same product entered twice isn't a near tie (Harel, 2026-11-06).
    const twin = { ...pulley36, id: "twin", docKeys: ["d:e"] };
    expect(bestLinks([p], [pulley36, twin]).map((l) => l.itemId)).toEqual(["twin"]);
    // Two different items that score alike are.
    const other = { ...pulley36, id: "other", name: '36T HTD 5mm 9mm wide 1/2" Hex Pulley (WCP)' };
    expect(bestLinks([part({ id: "b", names: ["36T HTD Pulley"] })], [pulley36, other])).toEqual([]);
  });
});

describe("names from Onshape and vendors", () => {
  const link = (name: string, i: LinkItem) => scoreLink(part({ names: [name] }), i).score;
  const screw = (id: string, name: string, kind: string, length: string) => item({ id, name, category: cat("fasteners"), specs: { kind, thread: "M5", length } });
  const shcs10 = screw("s10", "M5×10 גלילי", "SHCS (רגיל)", "10");
  const button10 = screw("b10", "M5×10 כיפה", "Button Head (כיפה)", "10");
  const flat10 = screw("f10", "M5×10 קוני", "Flat Head (קוני)", "10");

  it("links McMaster screws by thread, length and head, not the thread pitch", () => {
    const parts = ["Hex socket head cap screw M5x0.80 x 10", "Socket button head screw M5x0.8 x 10", "Hex socket countersunk head screw M5x0.8 x 10"].map((n, k) => part({ id: `p${k}`, names: [n] }));
    expect(bestLinks(parts, [shcs10, button10, flat10]).map((l) => l.itemId)).toEqual(["s10", "b10", "f10"]);
    expect(link("Hex socket head cap screw M5x0.80 x 12", shcs10)).toBe(0);
    expect(link("Hex socket head cap screw M5x0.80 x 10 x 22", shcs10)).toBeGreaterThanOrEqual(LINK_THRESHOLD);
  });

  it("reads 5M and 3M belt pitches", () => {
    const htd = item({ id: "h", name: "HTD 5mm Belt 225mm (45T) 9mm", category: cat("belts"), specs: { pitch: "HTD 5mm", teeth: "45", width: "9", groove: "Single" } });
    const gt2 = item({ id: "g", name: "GT2 3mm Belt 135mm (45T) 9mm", category: cat("belts"), specs: { pitch: "GT2 3mm", teeth: "45", width: "9", groove: "Single" } });
    expect(bestLinks([part({ names: ["45T 5M 9mm Wide Belt"] })], [htd, gt2]).map((l) => l.itemId)).toEqual(["h"]);
    expect(bestLinks([part({ names: ["45T 3M 9mm Wide Belt"] })], [htd, gt2]).map((l) => l.itemId)).toEqual(["g"]);
  });

  it("tells spur from bevel and aluminum from steel gears", () => {
    // The live Gears category has hidden Type and Material fields.
    const base = cat("gears")!;
    const gears: InvCategory = {
      ...base,
      fields: [
        ...base.fields,
        { id: "type", kind: "options", label: "Type", hidden: true, options: ["Spur", "Bevel", "Ball shifter"] },
        { id: "material", kind: "options", label: "Material", hidden: true, options: ["Aluminum", "Steel", "Plastic"] },
      ],
    };
    const spec = { dp: "20 DP", bore: '1/2" Hex', teeth: "40" };
    const plain = item({ id: "a", name: '20DP 40T 1/2" Hex Gear', category: gears, specs: spec });
    const steel = item({ id: "s", name: '20DP 40T 1/2" Hex Steel Gear', category: gears, specs: { ...spec, material: "Steel" } });
    const bevel = item({ id: "b", name: '20DP 40T 1/2" Hex Bevel Gear', category: gears, specs: { ...spec, type: "Bevel" } });
    expect(bestLinks([part({ names: ['40t Aluminum Spur Gear (20 DP, 1/2" Hex Bore)'] })], [plain, steel, bevel]).map((l) => l.itemId)).toEqual(["a"]);
  });

  it("reads wheel diameters and durometers, and bearing sizes", () => {
    const green = item({ id: "w", name: '2.25" Compliant Wheel, 1/2" Hex, 35A (Green)', category: cat("wheels"), specs: { type: "Compliant", diameter: '2.25"', bore: '1/2" Hex', durometer: "35A" } });
    const black = item({ id: "k", name: '2.25" Compliant Wheel, 1/2" Hex, 60A (Black)', category: cat("wheels"), specs: { type: "Compliant", diameter: '2.25"', bore: '1/2" Hex', durometer: "60A" } });
    expect(bestLinks([part({ names: ['2.25" Compliant Wheel (35A, 1" Wide, 1/2" Hex Bore)'] })], [green, black]).map((l) => l.itemId)).toEqual(["w"]);
    const bearing = item({ id: "r", name: "8x16x5 Flanged Bearing", category: cat("bearings"), specs: { bore: "8", od: "16", width: "5", flanged: "Flanged" } });
    expect(link("WCP Metric Ball Bearings – 1508 8mm ID x 16mm OD x 5mm WD", bearing)).toBeGreaterThanOrEqual(LINK_THRESHOLD);
    const bearing25 = item({ id: "r25", name: "25x32x4 Bearing", category: cat("bearings"), specs: { bore: "25", od: "32", width: "4" } });
    expect(link("25-32-4", bearing25)).toBeGreaterThanOrEqual(LINK_THRESHOLD);
  });

  it("doesn't take an accessory for its product", () => {
    expect(link("Kraken X60 Back Cap (WCP)", item({ name: "Kraken X60", category: cat("motors"), specs: { model: "Kraken X60" } }))).toBe(0);
  });

  it("never links Raw Stock by picture or Part Studio", () => {
    const filament = item({ name: "Bambu PLA – Black filament", category: cat("filament"), thumbHashes: [{ hash: "f0f0f0f0f0f0f0f0", partName: "a print" }], docKeys: ["d:e"] });
    expect(scoreLink(part({ names: ["25-32-4"], thumbHash: "f0f0f0f0f0f0f0f0", docKey: "d:e" }), filament).score).toBe(0);
  });
});
