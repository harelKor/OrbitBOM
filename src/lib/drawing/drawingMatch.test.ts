import { describe, expect, it } from "vitest";
import { cleanName, extractPartCodes, matchDrawingTab } from "./drawingMatch";

const tabs = (...names: string[]) => names.map((name) => ({ name }));

describe("drawing tab matching", () => {
  it("reads part codes wherever they sit", () => {
    expect(extractPartCodes("1691-26-431-05A Drawing")).toEqual(["1691-26-431-05A"]);
    expect(extractPartCodes("Drawing - 1690-26-411-01a")).toEqual(["1690-26-411-01A"]);
    expect(extractPartCodes("1691-26-431")).toEqual(["1691-26-431"]);
    expect(extractPartCodes("1691-26-431-05A-Drawing")).toEqual(["1691-26-431-05A"]);
    expect(extractPartCodes("שרטוט 1691-26-431-13A")).toEqual(["1691-26-431-13A"]);
    expect(extractPartCodes("Side plate")).toEqual([]);
  });

  it("matches by code first, then by a shorter code the part's starts with", () => {
    const t = tabs("Drawing - 1690-26-411-01A", "1691-26-431-05A Drawing", "1691-26-431");
    expect(matchDrawingTab(["1691-26-431-05A Side plate"], t)?.name).toBe("1691-26-431-05A Drawing");
    expect(matchDrawingTab(["Side plate", null, "1690-26-411-01A"], t)?.name).toBe("Drawing - 1690-26-411-01A");
    expect(matchDrawingTab(["1691-26-431-07A"], t)?.name).toBe("1691-26-431");
    expect(matchDrawingTab(["1691-26-999-01A"], t)).toBeNull();
    // A coded part never falls back to its name.
    expect(matchDrawingTab(["1692-26-100-01A Side plate"], tabs("Side plate drawing"))).toBeNull();
  });

  it("falls back to cleaned names for parts without a code", () => {
    expect(cleanName("Side Plate - Drawing Rev B.pdf")).toBe("side plate");
    expect(cleanName("שרטוט צלחת")).toBe("צלחת");
    expect(matchDrawingTab(["Side plate"], tabs("Drawing 1", "Side_Plate DWG"))?.name).toBe("Side_Plate DWG");
    expect(matchDrawingTab(["Intake side plate"], tabs("Side plate - sheet"))?.name).toBe("Side plate - sheet");
    expect(matchDrawingTab(["Plate"], tabs("Plates"))).toBeNull();
    expect(matchDrawingTab(["Arm"], tabs("Arm drawing"))?.name).toBe("Arm drawing");
    expect(matchDrawingTab(["Arm"], tabs("Arm pivot drawing"))).toBeNull(); // too short to match inside
  });
});
