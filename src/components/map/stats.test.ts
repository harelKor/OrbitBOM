import { describe, expect, it } from "vitest";
import { placeStats } from "./stats";

const places = [
  { id: "z", name: "Zone 1" },
  { id: "d", name: "Zone 1 · Drawer 1", parentId: "z", spotX: 0.5, spotY: 0.5, kind: "drawer" as const },
];
const categories = [
  { id: "bearings", label: "Bearings", imageUrl: "/categories/bearings.png" },
  { id: "gears", label: "Gears", imageUrl: "/categories/gears.png" },
  { id: "misc", label: "Misc", imageUrl: null },
];
const item = (id: string, category: string) => ({ id, name: id, category, place: "d", short: false });

describe("placeStats pictures", () => {
  it("shows the category most of a drawer's items are", () => {
    const st = placeStats([item("a", "bearings"), item("b", "gears"), item("c", "gears")], places, categories);
    expect(st.get("d")?.picture).toBe("/categories/gears.png");
    expect(st.get("z")?.count).toBe(3);
  });
  it("breaks a tie by name", () => {
    expect(placeStats([item("a", "gears"), item("b", "bearings")], places, categories).get("d")?.picture).toBe("/categories/bearings.png");
  });
  it("skips a category with no picture", () => {
    expect(placeStats([item("a", "misc"), item("b", "misc"), item("c", "gears")], places, categories).get("d")?.picture).toBe("/categories/gears.png");
  });
});
