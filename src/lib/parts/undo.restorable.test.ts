import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/visits", () => ({ currentVisit: async () => null }));
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/db";

describe("restorable", async () => {
  const { restorable } = await import("./undo");
  it("never writes an empty value into a field that can't be empty", () => {
    expect(restorable("cotsLinks", null)).toEqual([]);
    expect(restorable("fabricators", null)).toEqual({});
    expect(restorable("classification", null)).toBe("undefined");
    expect(restorable("priority", undefined)).toBe("normal");
    expect(restorable("doneProcess1", null)).toBe(0);
  });
  it("keeps real values and empties fields that may be empty", () => {
    expect(restorable("material", null)).toBeNull();
    expect(restorable("cotsLinks", [{ url: "https://x.com" }])).toEqual([{ url: "https://x.com" }]);
    expect(restorable("quantity", 0)).toBe(0);
  });
});
