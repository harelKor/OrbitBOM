import { describe, expect, it } from "vitest";
import { placeInUseMessage } from "./places";

describe("placeInUseMessage", () => {
  it("lets an empty place go", () => {
    expect(placeInUseMessage("This zone", 0, 0)).toBeNull();
  });

  it("names what is still inside", () => {
    expect(placeInUseMessage("This zone", 3, 0)).toBe("This zone still holds 3 items. Move them to another place first.");
    expect(placeInUseMessage("This spot", 1, 0)).toBe("This spot still holds 1 item. Move it to another place first.");
    expect(placeInUseMessage("This zone", 2, 1)).toBe("This zone still holds 2 items and 1 item group. Move them to another place first.");
  });
});
