import { describe, expect, it } from "vitest";
import { storedBoreField, withBoreList, type CategoryField } from "./categories";

const bores = ['1/2" Hex', "SplineXS"];
const field = (f: Partial<CategoryField>): CategoryField => ({ id: "bore", label: "Bore", kind: "options", ...f });

describe("the global Bore list", () => {
  it("offers every global bore, then the field's own extras", () => {
    const f = withBoreList(field({ list: "bores", options: ["Falcon", "SplineXS"] }), bores);
    expect(f.options).toEqual(['1/2" Hex', "SplineXS", "Falcon"]);
    expect(f.ownOptions).toEqual(["Falcon", "SplineXS"]);
  });

  it("follows the list as it changes", () => {
    expect(withBoreList(field({ list: "bores", options: ["Falcon"] }), ["8mm"]).options).toEqual(["8mm", "Falcon"]);
  });

  it("leaves fields off the list alone", () => {
    const f = field({ options: ["Falcon"] });
    expect(withBoreList(f, bores)).toBe(f);
  });

  it("stores only the extras, never the merged list", () => {
    const read = withBoreList(field({ list: "bores", options: ["Falcon"] }), bores);
    expect(storedBoreField(read, bores)).toEqual(field({ list: "bores", options: ["Falcon"] }));
    expect(storedBoreField(field({ list: "bores", options: [...bores, "CIM"] }), bores).options).toEqual(["CIM"]);
    expect(storedBoreField(field({ options: ["A"], ownOptions: ["B"] }), bores)).toEqual(field({ options: ["A"] }));
  });
});
