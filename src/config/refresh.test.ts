import { describe, expect, it } from "vitest";
import { refreshIntervalMinutes } from "./refresh";

describe("refreshIntervalMinutes", () => {
  it("checks every 10 minutes during meeting hours in Israel", () => {
    // 17:00 in Israel (UTC+3 in October).
    expect(refreshIntervalMinutes(new Date("2026-10-18T14:00:00Z"))).toBe(10);
  });

  it("checks hourly at night", () => {
    // 03:00 in Israel.
    expect(refreshIntervalMinutes(new Date("2026-10-18T00:00:00Z"))).toBe(60);
  });
});
