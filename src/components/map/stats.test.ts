import { describe, expect, it } from "vitest";
import { placeStats } from "./stats";

const places = [
  { id: "z", name: "Zone 1" },
  { id: "d", name: "Zone 1 · Drawer 1", parentId: "z", spotX: 0.5, spotY: 0.5, kind: "drawer" as const },
];
const categories = [{ id: "bearings", label: "Bearings", imageUrl: "/categories/bearings.png" }];
const item = (id: string, thumbUrl: string | null) => ({ id, name: id, category: "bearings", place: "d", short: false, thumbUrl });

describe("placeStats pictures", () => {
  it("shows a drawer's item photo before a category drawing", () => {
    const st = placeStats([item("a", null), item("b", "https://r2/b.jpg")], places, categories);
    expect(st.get("d")?.picture).toBe("https://r2/b.jpg");
    expect(st.get("z")?.count).toBe(2);
  });
  it("falls back to the category's picture", () => {
    expect(placeStats([item("a", null)], places, categories).get("d")?.picture).toBe("/categories/bearings.png");
  });
});
