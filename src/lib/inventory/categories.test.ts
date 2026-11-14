import { describe, expect, it } from "vitest";
import { categoryOf, type InvCategory } from "./categories";

const cat = (id: string, sheet = false): InvCategory => ({ id, label: id, noun: id, group: "consumables", sheet, image: null, defaultLocationId: null, fields: [] });

describe("categoryOf", () => {
  it("keeps a known category", () => {
    expect(categoryOf({ category: "plates", name: "608 Bearing" }, [cat("plates", true), cat("other")])).toBe("plates");
  });

  it("falls back to Other", () => {
    expect(categoryOf({ category: null, name: "Mystery thing" }, [cat("plates", true), cat("other")])).toBe("other");
    expect(categoryOf({ category: "gone", name: "Mystery thing" }, [cat("plates", true), cat("other")])).toBe("other");
  });

  it("never falls back to a sheet category", () => {
    expect(categoryOf({ category: null, name: "Mystery thing" }, [cat("tools"), cat("plates", true)])).toBe("tools");
    // Only sheet categories: an id no category has, which pages treat as a plain item.
    expect(categoryOf({ category: null, name: "Mystery thing" }, [cat("cylinders-blocks", true)])).toBe("other");
  });
});
