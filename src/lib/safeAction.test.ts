import { describe, expect, it } from "vitest";
import { safeAction } from "./safeAction";

describe("safeAction", () => {
  it("passes a result through", async () => {
    expect(await safeAction(async (): Promise<{ error?: string; message?: string }> => ({ message: "ok" }))).toEqual({ message: "ok" });
    expect(await safeAction(async () => ({ error: "Unknown item." }))).toEqual({ error: "Unknown item." });
  });

  it("turns a throw into Not saved", async () => {
    expect(await safeAction(async () => Promise.reject(new TypeError("Failed to fetch")))).toEqual({ error: "Not saved. Check the connection and try again." });
    expect(await safeAction(async () => Promise.reject(new Error("You can't change stock.")))).toEqual({ error: "Not saved. You can't change stock." });
  });
});
