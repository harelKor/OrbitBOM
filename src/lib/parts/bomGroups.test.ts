import { describe, expect, it } from "vitest";
import { findGroup, groupParts, matchesType, type GroupItem, type GroupPart } from "./bomGroups";

let n = 0;
const part = (over: Partial<GroupPart>): GroupPart => ({
  id: `p${n++}`,
  classification: "inhouse",
  material: null,
  quantity: 1,
  process1: null,
  addedProcesses: [],
  displayName: null,
  onshapeName: null,
  inventoryItemId: null,
  ...over,
});
const item = (id: string, category: string, specs: Record<string, string> = {}, name = id): GroupItem => ({ id, name, category, raw: !!specs.raw || category.includes("plates") || category.includes("tubes") || category === "shafts" || category === "polycarbonate", specs });

const ITEMS = [
  item("bearing", "bearings"),
  item("al4", "aluminum-plates", { thickness: "4" }, "Aluminum 4mm"),
  item("al6", "aluminum-plates", { thickness: "6" }, "Aluminum 6mm"),
  item("al3", "aluminum-plates", { thickness: "3" }, "Aluminum 3mm"),
  item("pc2", "polycarbonate", { thickness: "2" }, "Polycarbonate 2mm"),
  item("hex", "shafts", {}, '1/2" Hex'),
  item("box", "square-tubes", {}, "Box 1x2"),
];

const names = (gs: { name: string }[]) => gs.map((g) => g.name);

describe("groupParts", () => {
  it("sorts bought, made and not set up parts into their groups", () => {
    const groups = groupParts(
      [
        part({ classification: "cots", inventoryItemId: "bearing", quantity: 4 }),
        part({ classification: "cots", displayName: "Bearing 8mm flanged" }),
        part({ classification: "cots", displayName: "M5x20 BHCS" }),
        part({ classification: "cots", displayName: "Pop rivet 3/16" }),
        part({ classification: "cots", displayName: "Kraken X60" }),
        part({ process1: "3d-bambu" }),
        part({ material: '1/2" Hex', inventoryItemId: "hex" }),
        part({ material: "Box 1x2" }), // linked by name only
        part({ material: "Aluminum 4mm", inventoryItemId: "al4", quantity: 2 }),
        part({ classification: "undefined" }),
        part({}),
      ],
      ITEMS,
    );
    expect(names(groups)).toEqual(["Bearings", "Screws", "COTS", "3D prints", "Shafts", "Box tubes", "4 mm Aluminum", "Not set up"]);
    expect(groups[0].parts).toHaveLength(2);
    expect(groups[0].pieces).toBe(5);
    expect(findGroup(groups, "Not set up")?.parts).toHaveLength(2);
  });

  it("nests sheets under their material past 3 sheet groups", () => {
    const sheets = ["al4", "al6", "al3", "pc2"].map((id) => part({ inventoryItemId: id }));
    expect(names(groupParts(sheets.slice(0, 3), ITEMS))).toEqual(["3 mm Aluminum", "4 mm Aluminum", "6 mm Aluminum"]);
    const nested = groupParts(sheets, ITEMS);
    expect(names(nested)).toEqual(["Aluminum", "Polycarbonate"]);
    expect(names(nested[0].children!)).toEqual(["3 mm", "4 mm", "6 mm"]);
    expect(nested[0].parts).toHaveLength(3);
    expect(nested[1].children).toBeUndefined();
  });

  it("splits a big Screws group by thread", () => {
    const screws = ["M5x10 SHCS", "M5x20 BHCS", "M4x8 BHCS", "#10-32 x 1/2\" BHCS", "M5 nylock nut", "M3x6 SHCS", "M4 washer", "Pop rivet", "M4x12 FHCS"].map((d) =>
      part({ classification: "cots", displayName: d }),
    );
    const [g] = groupParts(screws, ITEMS);
    expect(g.name).toBe("Screws");
    expect(names(g.children!)).toEqual(["#10-32", "M3", "M4", "M5", "Rivets"]);
    expect(findGroup([g], "screws:M5")?.parts).toHaveLength(3);
    expect(groupParts(screws.slice(0, 8), ITEMS)[0].children).toBeUndefined();
  });
});

describe("matchesType", () => {
  it("tells COTS, in-house and Factory Fab parts apart", () => {
    const zivudim = part({ process1: "zivudim" });
    const later = part({ process1: "laser", addedProcesses: [{ machine: "beth-el" }] });
    const hadasa = part({ process1: "hadasas" });
    expect(matchesType(zivudim, "factory")).toBe(true);
    expect(matchesType(later, "factory")).toBe(true);
    expect(matchesType(hadasa, "factory")).toBe(false);
    expect(matchesType(part({ classification: "cots" }), "inhouse")).toBe(false);
    expect(matchesType(part({}), "all")).toBe(true);
  });
});
