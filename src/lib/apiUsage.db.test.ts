// Runs against a real Postgres when TEST_DATABASE_URL is set. The clock is moved to 2031 so this
// file's "today" is its own.
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("API daily caps (database): set TEST_DATABASE_URL", () => {});
else
  describe("API daily caps (database)", async () => {
    process.env.DATABASE_URL = url;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-03-04T12:00:00Z"));
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { takeApiCall } = await import("./apiUsage");
    const { API_DAILY } = await import("@/config/apiLimits");

    afterAll(async () => {
      await db.delete(schema.apiUsage).where(eq(schema.apiUsage.day, "2031-03-04"));
      vi.useRealTimers();
    });

    it("counts each call and refuses past the day's cap, also when asked at once", async () => {
      const cap = API_DAILY["serper-lens"];
      const answers = await Promise.all(Array.from({ length: cap + 5 }, () => takeApiCall("serper-lens")));
      expect(answers.filter(Boolean)).toHaveLength(cap);
      const [row] = await db.select().from(schema.apiUsage).where(eq(schema.apiUsage.service, "serper-lens"));
      expect(row.calls).toBe(cap);
      // Another service has its own count.
      expect(await takeApiCall("gemini")).toBe(true);
    });
  });
