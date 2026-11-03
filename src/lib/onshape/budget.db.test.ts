// Runs against a real Postgres when TEST_DATABASE_URL is set. Onshape is replaced by a fake fetch.
// The clock is moved to 2030 so this file's "today" never touches the day other tests count on.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("Onshape call budget (database): set TEST_DATABASE_URL", () => {});
else
  describe("Onshape call budget (database)", async () => {
    process.env.DATABASE_URL = url;
    process.env.ONSHAPE_TOKEN_KEY = randomBytes(32).toString("base64");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-01-02T12:00:00Z"));
    const { db, schema } = await import("@/db");
    const { eq, inArray } = await import("drizzle-orm");
    const { encrypt } = await import("@/lib/crypto");
    const { onshapeClient, TeamBudgetError } = await import("./client");
    const { BACKGROUND_SHARE, TEAM_DAILY_CALLS, YEARLY_CALLS } = await import("@/config/onshapeBudget");
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));

    const days = ["2030-01-01", "2030-01-02"];
    const userId = randomUUID();
    const [member] = await db.insert(schema.members).values({ userId, email: `${userId}@t.org`, name: "Budget Tester", onshapeConnected: true }).returning();
    await db.insert(schema.onshapeTokens).values({ memberId: member.id, accessTokenEnc: encrypt("a"), refreshTokenEnc: encrypt("r"), expiresAt: new Date(Date.now() + 3600_000) });
    const base = "https://cad.onshape.com";
    const setToday = (calls: number) =>
      db.insert(schema.onshapeUsage).values({ day: days[1], calls }).onConflictDoUpdate({ target: schema.onshapeUsage.day, set: { calls } });

    afterAll(async () => {
      await db.delete(schema.onshapeUsage).where(inArray(schema.onshapeUsage.day, days));
      await db.delete(schema.members).where(eq(schema.members.id, member.id));
      vi.useRealTimers();
    });

    it("stops thumbnails and previews first, keeping the rest of the day for Update BOM", async () => {
      await setToday(Math.floor(TEAM_DAILY_CALLS * BACKGROUND_SHARE));
      await expect(onshapeClient(member.id, base, { background: true }).json("documents")).rejects.toBeInstanceOf(TeamBudgetError);
      await onshapeClient(member.id, base).json("documents");
      const [row] = await db.select().from(schema.onshapeUsage).where(eq(schema.onshapeUsage.day, days[1]));
      expect(row.calls).toBe(Math.floor(TEAM_DAILY_CALLS * BACKGROUND_SHARE) + 1);

      await setToday(TEAM_DAILY_CALLS);
      await expect(onshapeClient(member.id, base).json("documents")).rejects.toBeInstanceOf(TeamBudgetError);
      // A refused call isn't counted.
      const [after] = await db.select().from(schema.onshapeUsage).where(eq(schema.onshapeUsage.day, days[1]));
      expect(after.calls).toBe(TEAM_DAILY_CALLS);
    });

    it("stops everything once the year's allowance is used", async () => {
      await setToday(0);
      await db.insert(schema.onshapeUsage).values({ day: days[0], calls: YEARLY_CALLS });
      vi.setSystemTime(new Date("2030-01-02T12:05:00Z")); // past the one-minute cache of the year's count
      await expect(onshapeClient(member.id, base).json("documents")).rejects.toThrow(/this year's Onshape calls/);
    });
  });
