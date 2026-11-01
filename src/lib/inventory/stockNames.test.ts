import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORIES } from "@/config/inventory";
import { BASE_MATERIALS } from "@/config/materials";
import { buildName, specLine, type InvCategory } from "./categories";
import { parseQuick } from "./quick";

// As listCategories gives them: material fields without options offer every base material.
const cats: InvCategory[] = DEFAULT_CATEGORIES.map((c) => ({
  id: c.id,
  label: c.label,
  noun: c.noun,
  group: c.group,
  sheet: !!c.sheet,
  image: null,
  defaultLocationId: null,
  fields: c.fields.map((f) => (f.kind === "material" ? { ...f, materialChoices: f.options?.length ? f.options : BASE_MATERIALS } : f)),
}));
const tubes = cats.find((c) => c.id === "round-tubes")!;
const stock = cats.find((c) => c.id === "cylinders-blocks")!;

describe("round tubes", () => {
  it("names them <Material> <OD>x<Wall> tube", () => {
    expect(buildName(tubes, { material: "Aluminum", od: "25", wall: "2", length: "1000" })).toBe("Aluminum 25x2 tube");
    expect(buildName(tubes, { material: "Carbon Fiber", od: "22mm", wall: "1.5mm" })).toBe("Carbon Fiber 22x1.5 tube");
    expect(buildName(tubes, { material: "Polycarbonate", od: "50" })).toBe("Polycarbonate Ø50 tube");
    expect(specLine(tubes, { material: "Aluminum", od: "25", wall: "2", length: "1000" })).toBe("Aluminum · 25x2 · 1000mm");
  });
  it("reads them from typing", () => {
    expect(parseQuick("aluminum 25x2 tube", cats)).toEqual({ categoryId: "round-tubes", specs: { material: "Aluminum", od: "25", wall: "2" }, left: [] });
    expect(parseQuick("carbon 20x1.5 tube", cats)).toEqual({ categoryId: "round-tubes", specs: { material: "Carbon Fiber", od: "20", wall: "1.5" }, left: [] });
    expect(parseQuick("poly 50x3 tube 1000mm", cats)?.specs).toEqual({ material: "Polycarbonate", od: "50", wall: "3", length: "1000" });
  });
});

describe("cylinders & blocks", () => {
  it("names blocks and cylinders", () => {
    expect(buildName(stock, { shape: "Block", material: "Aluminum", x: "50", y: "50", z: "100" })).toBe("Aluminum 50x50x100 block");
    expect(buildName(stock, { shape: "Cylinder", material: "Brass", od: "30", length: "150" })).toBe("Brass Ø30 cylinder");
    expect(buildName(stock, { shape: "Cylinder", material: "Aluminum", od: "8" })).toBe("Aluminum Ø8 cylinder");
    expect(buildName(stock, { shape: "Block", material: "Steel" })).toBe("Steel block");
    expect(specLine(stock, { shape: "Cylinder", material: "Brass", od: "30", length: "150" })).toBe("Cylinder · Brass · Ø30x150");
  });
  it("reads them from typing", () => {
    expect(parseQuick("aluminum 50x50x100 block", cats)).toEqual({ categoryId: "cylinders-blocks", specs: { shape: "Block", material: "Aluminum", x: "50", y: "50", z: "100" }, left: [] });
    expect(parseQuick("brass Ø30x150 cylinder", cats)).toEqual({ categoryId: "cylinders-blocks", specs: { shape: "Cylinder", material: "Brass", od: "30", length: "150" }, left: [] });
    expect(parseQuick("delrin 40x200 cylinder", cats)?.specs).toEqual({ shape: "Cylinder", material: "Delrin / Acetal", od: "40", length: "200" });
  });
});

describe("raw stock names", () => {
  const by = (id: string) => cats.find((c) => c.id === id)!;
  it("leave lengths and sheet sizes out", () => {
    expect(buildName(by("aluminum-plates"), { material: "6061-T6", thickness: "3", size: "500x900" })).toBe("6061-T6 3mm Plate");
    expect(buildName(by("polycarbonate"), { thickness: "2", size: "1200x2400" })).toBe("2mm Plate");
    expect(buildName(by("square-tubes"), { material: "Aluminum", size: "25x50", wall: "2", length: "1000" })).toBe("25x50mm 2mm wall Box tube");
    expect(buildName(by("square-tubes"), { material: "Carbon Fiber", size: "22x22", wall: "1.3" })).toBe("Carbon Fiber 22x22mm 1.3mm wall Box tube");
    expect(buildName(by("shafts"), { profile: '1/2" Hex', length: "900" })).toBe('1/2" Hex Shaft');
  });
  it("read a box tube typed with or without aluminum", () => {
    for (const text of ["aluminum 25x50 2mm wall box tube", "25x50 2mm wall box tube"]) {
      const q = parseQuick(text, cats)!;
      expect(q.categoryId).toBe("square-tubes");
      expect(buildName(by("square-tubes"), q.specs)).toBe("25x50mm 2mm wall Box tube");
    }
    expect(parseQuick("25x50x1.5 box tube 1000mm", cats)?.specs).toMatchObject({ size: "25x50", wall: "1.5", length: "1000" });
    expect(buildName(by("square-tubes"), parseQuick('1x1" 1/8" box tube', cats)!.specs)).toBe('1x1" 1/8" wall Box tube');
  });
  it("still read a typed length into specs", () => {
    expect(parseQuick('1/2" hex shaft 900mm', cats)?.specs).toMatchObject({ profile: '1/2" Hex', length: "900" });
  });
});

describe("name templates", () => {
  const cat: InvCategory = {
    id: "t",
    label: "Test",
    noun: "Tube",
    group: "hardware",
    sheet: false,
    image: null,
    defaultLocationId: null,
    fields: [
      { id: "a", label: "A", kind: "text" },
      { id: "b", label: "B", kind: "text", name: "x{}" },
      { id: "c", label: "C", kind: "text", name: " {}mm" },
      { id: "d", label: "D", kind: "text", name: "{}mm" },
    ],
  };
  it("keep the spacing before {} as written", () => {
    expect(buildName(cat, { a: "25x50", b: "2" })).toBe("25x50x2 Tube");
    expect(buildName(cat, { a: "25", c: "3" })).toBe("25 3mm Tube");
    expect(buildName(cat, { a: "25", d: "3" })).toBe("253mm Tube");
    expect(buildName(cat, { b: "2" })).toBe("x2 Tube");
  });
});

describe("box tube auto-link sizes", () => {
  it("treat 25×50 and 50x25 as one profile", async () => {
    const { scoreLink } = await import("./linkScore");
    const cat = cats.find((c) => c.id === "square-tubes")!;
    const item = { category: cat, specs: { size: "25×50", wall: "1.5" }, name: "Box tube 25×50×1.5mm", aliases: [], urls: [], thumbHashes: [], docKeys: [] };
    const part = { names: ["50x25x1.5 box tube"], urls: [] };
    expect(scoreLink(part as never, item as never).score).toBeGreaterThan(0);
  });
});
