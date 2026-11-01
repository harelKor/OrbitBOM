import { describe, expect, it } from "vitest";
import { matchTier, rankGrouped } from "./rank";

describe("matchTier", () => {
  it("ranks exact, whole word, prefix, word prefix, substring", () => {
    expect(matchTier("PLA", "pla")).toBe(1);
    expect(matchTier("Bambu PLA Black", "pla")).toBe(2);
    expect(matchTier("Plastic sheet", "pla")).toBe(3);
    expect(matchTier("Aluminum plate", "pla")).toBe(4);
    expect(matchTier("Templates", "pla")).toBe(5);
    expect(matchTier("Steel", "pla")).toBe(0);
  });
});

describe("rankGrouped", () => {
  it("puts PLA before aluminum plates and keeps groups together", () => {
    const items = [
      { label: "3mm Aluminum plate", group: "Aluminum Plates" },
      { label: "4mm Aluminum plate", group: "Aluminum Plates" },
      { label: "Bambu PLA", group: "Filament" },
      { label: "PLA", group: "General Materials" },
    ];
    const out = rankGrouped(items, "pla", (i) => i.label, (i) => i.group).map((i) => i.label);
    expect(out).toEqual(["PLA", "Bambu PLA", "3mm Aluminum plate", "4mm Aluminum plate"]);
  });
});
