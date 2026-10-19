// Runs against a real Postgres when TEST_DATABASE_URL is set.
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const url = process.env.TEST_DATABASE_URL;

if (!url) describe.skip("listMyParts (database): set TEST_DATABASE_URL", () => {});
else
  describe("listMyParts (database)", async () => {
    process.env.DATABASE_URL = url;
    const { db, schema } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const { listMyParts } = await import("./parts");

    const me = `Tester ${randomUUID().slice(0, 8)}`;
    const [robot] = await db.insert(schema.robots).values({ name: "Mine bot", year: 2027 }).returning();
    const [old] = await db.insert(schema.robots).values({ name: "Old bot", year: 2026, archived: true }).returning();
    const [system] = await db.insert(schema.systems).values({ robotId: robot.id, name: "Arm" }).returning();
    const [oldSystem] = await db.insert(schema.systems).values({ robotId: old.id, name: "Arm" }).returning();
    await db.insert(schema.parts).values([
      { systemId: system.id, isManual: true, displayName: "Designed", designerName: me },
      { systemId: system.id, isManual: true, displayName: "Machined", fabricators: { process1: me } },
      { systemId: system.id, isManual: true, displayName: "Someone else's", designerName: "Other" },
      { systemId: system.id, isManual: true, displayName: "Gone", designerName: me, removedFromCadAt: new Date() },
      { systemId: oldSystem.id, isManual: true, displayName: "Archived", designerName: me },
    ]);

    afterAll(async () => {
      await db.delete(schema.robots).where(eq(schema.robots.id, robot.id));
      await db.delete(schema.robots).where(eq(schema.robots.id, old.id));
    });

    it("lists live parts I design or fabricate on active robots", async () => {
      const mine = await listMyParts(me);
      expect(mine.map((p) => p.displayName).sort()).toEqual(["Designed", "Machined"]);
      expect(mine[0].systemName).toBe("Mine bot › Arm");
    });
  });
